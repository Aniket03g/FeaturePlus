package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// GitHubApp is the FeaturePlus GitHub App as registered on GitHub, read from
// the server's environment. People connect to GitHub through it: they sign in,
// choose which repositories FeaturePlus may use, and FeaturePlus then acts as
// them on those repositories only.
type GitHubApp struct {
	AppID        string
	Slug         string
	ClientID     string
	ClientSecret string

	// OAuthBaseURL is github.com, and APIBaseURL api.github.com; tests point
	// both at a fake.
	OAuthBaseURL string
	APIBaseURL   string
	HTTP         *http.Client
}

// NewGitHubAppFromEnv reads the app's settings. Missing ones leave it
// unconfigured, which Configured reports.
func NewGitHubAppFromEnv() *GitHubApp {
	return &GitHubApp{
		AppID:        strings.TrimSpace(os.Getenv("GITHUB_APP_ID")),
		Slug:         strings.TrimSpace(os.Getenv("GITHUB_APP_SLUG")),
		ClientID:     strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID")),
		ClientSecret: strings.TrimSpace(os.Getenv("GITHUB_CLIENT_SECRET")),
		OAuthBaseURL: "https://github.com",
		APIBaseURL:   "https://api.github.com",
		HTTP:         &http.Client{Timeout: 20 * time.Second},
	}
}

// Configured reports whether the server has what it needs to connect anyone.
func (a *GitHubApp) Configured() bool {
	return a.Slug != "" && a.ClientID != "" && a.ClientSecret != ""
}

// AuthorizeURL is where a person signs in to GitHub and approves FeaturePlus.
func (a *GitHubApp) AuthorizeURL(state, redirectURI string) string {
	q := url.Values{}
	q.Set("client_id", a.ClientID)
	q.Set("state", state)
	q.Set("redirect_uri", redirectURI)
	return strings.TrimRight(a.OAuthBaseURL, "/") + "/login/oauth/authorize?" + q.Encode()
}

// InstallURL is where a person chooses which repositories FeaturePlus may
// use. Because the app asks for sign-in during installation, GitHub comes back
// to the callback with a code afterwards, the same as after AuthorizeURL.
func (a *GitHubApp) InstallURL(state string) string {
	return strings.TrimRight(a.OAuthBaseURL, "/") + "/apps/" + url.PathEscape(a.Slug) +
		"/installations/new?state=" + url.QueryEscape(state)
}

// GitHubUserToken is what GitHub hands back for a signed-in person.
type GitHubUserToken struct {
	AccessToken      string
	AccessExpiresAt  *time.Time
	RefreshToken     string
	RefreshExpiresAt *time.Time
}

// ExchangeCode turns the code GitHub sent to the callback into a token.
func (a *GitHubApp) ExchangeCode(code, redirectURI string) (*GitHubUserToken, error) {
	return a.tokenRequest(url.Values{
		"code":         {code},
		"redirect_uri": {redirectURI},
	})
}

// Refresh renews an expired access token.
func (a *GitHubApp) Refresh(refreshToken string) (*GitHubUserToken, error) {
	return a.tokenRequest(url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	})
}

func (a *GitHubApp) tokenRequest(form url.Values) (*GitHubUserToken, error) {
	form.Set("client_id", a.ClientID)
	form.Set("client_secret", a.ClientSecret)

	req, err := http.NewRequest(http.MethodPost,
		strings.TrimRight(a.OAuthBaseURL, "/")+"/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "FeaturePlus")

	resp, err := a.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	// GitHub answers 200 even for a refused code, with the reason in the body.
	var body struct {
		AccessToken           string `json:"access_token"`
		ExpiresIn             int    `json:"expires_in"`
		RefreshToken          string `json:"refresh_token"`
		RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
		Error                 string `json:"error"`
		ErrorDescription      string `json:"error_description"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, &GitHubError{Status: resp.StatusCode, Message: strings.TrimSpace(string(raw))}
	}
	if body.Error != "" || body.AccessToken == "" {
		message := body.ErrorDescription
		if message == "" {
			message = body.Error
		}
		if message == "" {
			message = "no token in the response"
		}
		return nil, &GitHubError{Status: http.StatusUnauthorized, Message: message}
	}

	token := &GitHubUserToken{AccessToken: body.AccessToken, RefreshToken: body.RefreshToken}
	now := time.Now()
	if body.ExpiresIn > 0 {
		at := now.Add(time.Duration(body.ExpiresIn) * time.Second)
		token.AccessExpiresAt = &at
	}
	if body.RefreshTokenExpiresIn > 0 {
		at := now.Add(time.Duration(body.RefreshTokenExpiresIn) * time.Second)
		token.RefreshExpiresAt = &at
	}
	return token, nil
}

// UserClient is an API client acting as a signed-in person.
func (a *GitHubApp) UserClient(accessToken string) *GitHubClient {
	return &GitHubClient{BaseURL: a.APIBaseURL, Token: accessToken, HTTP: a.HTTP}
}

// GetLogin returns the signed-in person's GitHub username.
func (c *GitHubClient) GetLogin() (string, error) {
	var out struct {
		Login string `json:"login"`
	}
	if err := c.call(http.MethodGet, "/user", nil, &out); err != nil {
		return "", err
	}
	return out.Login, nil
}

// InstalledRepos lists every repository the person can reach through the
// app: those on each installation they have access to. Only ones they can
// push to are useful to FeaturePlus, so Push says which.
func (c *GitHubClient) InstalledRepos() ([]GitHubRepo, error) {
	var installs struct {
		Installations []struct {
			ID int64 `json:"id"`
		} `json:"installations"`
	}
	if err := c.call(http.MethodGet, "/user/installations?per_page=100", nil, &installs); err != nil {
		return nil, err
	}

	repos := []GitHubRepo{}
	for _, install := range installs.Installations {
		for page := 1; page <= 10; page++ {
			var out struct {
				TotalCount   int          `json:"total_count"`
				Repositories []GitHubRepo `json:"repositories"`
			}
			endpoint := fmt.Sprintf("/user/installations/%d/repositories?per_page=100&page=%d", install.ID, page)
			if err := c.call(http.MethodGet, endpoint, nil, &out); err != nil {
				return nil, err
			}
			repos = append(repos, out.Repositories...)
			if len(out.Repositories) < 100 {
				break
			}
		}
	}
	return repos, nil
}

// ---------- keeping tokens unreadable at rest ----------

// TokenBox encrypts tokens before they are stored. Its key comes from the
// app's client secret, so a copied database file holds nothing usable without
// the server's .env as well. Replacing the client secret makes stored tokens
// unreadable, and people simply connect again.
type TokenBox struct{ aead cipher.AEAD }

// NewTokenBox builds a box from a secret.
func NewTokenBox(secret string) (*TokenBox, error) {
	if secret == "" {
		return nil, errors.New("no secret to encrypt tokens with")
	}
	key := sha256.Sum256([]byte("featureplus-github-tokens:" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &TokenBox{aead: aead}, nil
}

// Seal encrypts a token.
func (b *TokenBox) Seal(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b.aead.Seal(nonce, nonce, []byte(plain), nil)), nil
}

// Open decrypts a token Seal produced.
func (b *TokenBox) Open(sealed string) (string, error) {
	if sealed == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil || len(raw) < b.aead.NonceSize() {
		return "", errors.New("stored token is unreadable")
	}
	plain, err := b.aead.Open(nil, raw[:b.aead.NonceSize()], raw[b.aead.NonceSize():], nil)
	if err != nil {
		return "", errors.New("stored token is unreadable")
	}
	return string(plain), nil
}
