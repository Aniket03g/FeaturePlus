package v1

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/FeaturePlus/backend/services"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// githubAccounts is each person's connection to GitHub through the FeaturePlus
// GitHub App: connecting, keeping the token fresh, and handing out a client
// that acts as them.
//
// Connecting is two stops on GitHub. The person signs in and approves
// FeaturePlus; if they have not yet chosen any repositories for it, they are
// sent on to do that. Both stops come back to the same callback.
type githubAccounts struct {
	db  *gorm.DB
	app *services.GitHubApp
	box *services.TokenBox
}

func newGitHubAccounts(db *gorm.DB) *githubAccounts {
	app := services.NewGitHubAppFromEnv()
	box, err := services.NewTokenBox(app.ClientSecret)
	if err != nil && app.Configured() {
		log.WithError(err).Warn("GitHub tokens cannot be stored")
	}
	return &githubAccounts{db: db, app: app, box: box}
}

const (
	githubStateCookie = "fp_github_state"
	githubCallbackAPI = "/api/v1/github/callback"
	defaultReturnPath = "/app/"
)

// errGitHubNotConnected is what every GitHub action says to someone who has
// not connected yet. The field lets the screen offer the button rather than
// just showing the message.
func errGitHubNotConnected(message string) *api.Error {
	return api.Conflict(message).WithField("github", "not_connected")
}

func (a *githubAccounts) register(g *gin.RouterGroup) {
	g.GET("/github/account", a.getAccount)
	g.DELETE("/github/account", a.disconnect)
	g.GET("/github/connect", a.connect)
	g.GET("/github/callback", a.callback)
	g.GET("/github/repos", a.repos)
}

// GitHubAccountDTO says whether the caller is connected, and where to go to
// connect or to change which repositories FeaturePlus may use.
type GitHubAccountDTO struct {
	// AppConfigured is false when the server has no GitHub App settings; no
	// one can connect until it does.
	AppConfigured bool   `json:"app_configured"`
	Connected     bool   `json:"connected"`
	Login         string `json:"login,omitempty"`
	// ManageURL is where the repositories FeaturePlus may use are chosen.
	ManageURL string `json:"manage_url,omitempty"`
}

// GET /api/v1/github/account
func (a *githubAccounts) getAccount(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	dto := GitHubAccountDTO{AppConfigured: a.app.Configured()}
	if dto.AppConfigured {
		dto.ManageURL = strings.TrimRight(a.app.OAuthBaseURL, "/") + "/apps/" + url.PathEscape(a.app.Slug) + "/installations/new"
	}
	var row models.UserGitHub
	if a.db.Where("user_id = ?", userID).First(&row).Error == nil {
		dto.Connected = true
		dto.Login = row.Login
	}
	api.OK(c, dto)
}

// disconnect forgets the caller's GitHub token. The app stays installed on
// their repositories until they remove it on GitHub.
//
// DELETE /api/v1/github/account
func (a *githubAccounts) disconnect(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	if dbErr := a.db.Where("user_id = ?", userID).Delete(&models.UserGitHub{}).Error; dbErr != nil {
		api.Fail(c, api.Internal(dbErr))
		return
	}
	api.NoContent(c)
}

// connect sends the browser to GitHub. It is opened as a page, not fetched:
// the answer is a redirect.
//
// GET /api/v1/github/connect?return_to=/app/projects/5/releases[&step=install]
func (a *githubAccounts) connect(c *gin.Context) {
	if !a.app.Configured() || a.box == nil {
		api.Fail(c, api.Unavailable("GitHub is not set up on this server: the GitHub App settings are missing from its .env file"))
		return
	}
	returnTo := safeReturnPath(c.Query("return_to"))
	state := a.newState(c, returnTo)

	if c.Query("step") == "install" {
		c.Redirect(http.StatusFound, a.app.InstallURL(state))
		return
	}
	c.Redirect(http.StatusFound, a.app.AuthorizeURL(state, a.redirectURI(c)))
}

// callback is where GitHub sends the browser back, after sign-in or after
// choosing repositories. It always ends by sending the browser back into the
// app, with ?github= saying how it went.
//
// GET /api/v1/github/callback?code=&state=[&installation_id=&setup_action=]
func (a *githubAccounts) callback(c *gin.Context) {
	returnTo, ok := a.takeState(c, c.Query("state"))
	if !ok {
		// Without a matching state this could be someone else's link; nothing
		// is exchanged.
		c.Redirect(http.StatusFound, withQuery(defaultReturnPath, "github", "expired"))
		return
	}
	if c.Query("error") != "" {
		c.Redirect(http.StatusFound, a.home(c, withQuery(returnTo, "github", "cancelled")))
		return
	}

	code := c.Query("code")
	if code == "" {
		// Repositories were chosen but GitHub sent no sign-in with them.
		c.Redirect(http.StatusFound, a.home(c, withQuery(returnTo, "github", "installed")))
		return
	}

	userID, err := api.UserID(c)
	if err != nil {
		c.Redirect(http.StatusFound, a.home(c, withQuery(returnTo, "github", "failed")))
		return
	}

	token, exErr := a.app.ExchangeCode(code, a.redirectURI(c))
	if exErr != nil {
		log.WithError(exErr).Warn("GitHub sign-in code was refused")
		c.Redirect(http.StatusFound, a.home(c, withQuery(returnTo, "github", "failed")))
		return
	}
	client := a.app.UserClient(token.AccessToken)
	login, loginErr := client.GetLogin()
	if loginErr != nil {
		log.WithError(loginErr).Warn("could not read the GitHub user")
		c.Redirect(http.StatusFound, a.home(c, withQuery(returnTo, "github", "failed")))
		return
	}
	if saveErr := a.save(userID, login, token); saveErr != nil {
		log.WithError(saveErr).Error("could not store the GitHub connection")
		c.Redirect(http.StatusFound, a.home(c, withQuery(returnTo, "github", "failed")))
		return
	}

	// Signed in but no repositories chosen yet: carry straight on to choosing
	// them, unless that is where this came from.
	if c.Query("setup_action") == "" {
		if repos, listErr := client.InstalledRepos(); listErr == nil && len(repos) == 0 {
			c.Redirect(http.StatusFound, a.app.InstallURL(a.newState(c, returnTo)))
			return
		}
	}
	c.Redirect(http.StatusFound, a.home(c, withQuery(returnTo, "github", "connected")))
}

// GitHubRepoDTO is one repository the caller could link a project to.
type GitHubRepoDTO struct {
	FullName      string `json:"full_name"`
	DefaultBranch string `json:"default_branch"`
	URL           string `json:"url"`
	CanPush       bool   `json:"can_push"`
}

// repos lists the repositories the caller chose for FeaturePlus on GitHub.
//
// GET /api/v1/github/repos
func (a *githubAccounts) repos(c *gin.Context) {
	userID, err := api.UserID(c)
	if err != nil {
		api.Fail(c, err)
		return
	}
	client, clientErr := a.clientFor(userID)
	if clientErr != nil {
		api.Fail(c, clientErr)
		return
	}
	found, listErr := client.InstalledRepos()
	if listErr != nil {
		api.Fail(c, githubFailure(listErr, "your repositories"))
		return
	}

	out := make([]GitHubRepoDTO, 0, len(found))
	seen := map[string]bool{}
	for _, r := range found {
		if seen[r.FullName] {
			continue
		}
		seen[r.FullName] = true
		out = append(out, GitHubRepoDTO{
			FullName: r.FullName, DefaultBranch: r.DefaultBranch, URL: r.HTMLURL, CanPush: r.Permissions.Push,
		})
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].FullName) < strings.ToLower(out[j].FullName) })
	api.OK(c, out)
}

// clientFor returns a client acting as the user, renewing their token first
// when it is about to run out.
func (a *githubAccounts) clientFor(userID int) (*services.GitHubClient, error) {
	if !a.app.Configured() || a.box == nil {
		return nil, api.Unavailable("GitHub is not set up on this server: the GitHub App settings are missing from its .env file")
	}

	var row models.UserGitHub
	if err := a.db.Where("user_id = ?", userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errGitHubNotConnected("Connect your GitHub account first")
		}
		return nil, api.Internal(err)
	}

	access, err := a.box.Open(row.AccessToken)
	if err != nil {
		return nil, errGitHubNotConnected("Your GitHub connection needs renewing. Connect GitHub again")
	}

	if row.AccessExpiresAt != nil && time.Until(*row.AccessExpiresAt) < 2*time.Minute {
		refresh, openErr := a.box.Open(row.RefreshToken)
		if openErr != nil || refresh == "" ||
			(row.RefreshExpiresAt != nil && time.Now().After(*row.RefreshExpiresAt)) {
			return nil, errGitHubNotConnected("Your GitHub connection has expired. Connect GitHub again")
		}
		token, refreshErr := a.app.Refresh(refresh)
		if refreshErr != nil {
			return nil, errGitHubNotConnected("GitHub would not renew your connection. Connect GitHub again")
		}
		if saveErr := a.save(userID, row.Login, token); saveErr != nil {
			return nil, api.Internal(saveErr)
		}
		access = token.AccessToken
	}

	return a.app.UserClient(access), nil
}

// save stores a person's tokens, replacing any earlier connection.
func (a *githubAccounts) save(userID int, login string, token *services.GitHubUserToken) error {
	access, err := a.box.Seal(token.AccessToken)
	if err != nil {
		return err
	}
	refresh, err := a.box.Seal(token.RefreshToken)
	if err != nil {
		return err
	}

	var row models.UserGitHub
	if findErr := a.db.Where("user_id = ?", userID).First(&row).Error; findErr != nil && !errors.Is(findErr, gorm.ErrRecordNotFound) {
		return findErr
	}
	row.UserID = userID
	row.Login = login
	row.AccessToken = access
	row.AccessExpiresAt = token.AccessExpiresAt
	row.RefreshToken = refresh
	row.RefreshExpiresAt = token.RefreshExpiresAt
	return a.db.Save(&row).Error
}

// redirectURI is the callback address GitHub must send the browser back to.
// It has to match one registered on the GitHub App exactly, so it can be set
// outright with GITHUB_REDIRECT_URL; otherwise it follows the address the app
// was opened on.
func (a *githubAccounts) redirectURI(c *gin.Context) string {
	if fixed := strings.TrimSpace(os.Getenv("GITHUB_REDIRECT_URL")); fixed != "" {
		return fixed
	}
	return requestOrigin(c) + githubCallbackAPI
}

// newState makes the one-time value that ties GitHub's answer to this browser,
// and remembers where to go afterwards: the page, and the address the app was
// open on. In development that is Vite's port rather than the server's, and
// GitHub may come back to either, so the way home is kept here.
func (a *githubAccounts) newState(c *gin.Context, returnTo string) string {
	raw := make([]byte, 16)
	_, _ = rand.Read(raw)
	state := hex.EncodeToString(raw)
	origin := requestOrigin(c)
	if saved, ok := a.savedOrigin(c); ok {
		// A second hop (sign-in, then choosing repositories) keeps the first
		// hop's origin: the request is GitHub's return, not the app's page.
		origin = saved
	}
	value := state + "|" + url.QueryEscape(returnTo) + "|" + url.QueryEscape(origin)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(githubStateCookie, value, 15*60, "/api/v1/github", "", false, true)
	return state
}

// takeState checks GitHub's state against the cookie and clears it, so one
// answer is used once. It returns the app path to go back to; home adds the
// address the person started from.
func (a *githubAccounts) takeState(c *gin.Context, state string) (string, bool) {
	cookie, err := c.Cookie(githubStateCookie)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(githubStateCookie, "", -1, "/api/v1/github", "", false, true)
	if err != nil || state == "" {
		return "", false
	}
	parts := strings.SplitN(cookie, "|", 3)
	if len(parts) < 2 || parts[0] != state {
		return "", false
	}
	returnTo, _ := url.QueryUnescape(parts[1])
	returnTo = safeReturnPath(returnTo)
	if len(parts) == 3 {
		origin, _ := url.QueryUnescape(parts[2])
		if safeOrigin(c, origin) {
			// Read by home, and carried into the next hop should there be one.
			c.Set(githubOriginKey, origin)
		}
	}
	return returnTo, true
}

// home turns an app path into the address to send the browser to: on the
// origin the person started from, when takeState found one.
func (a *githubAccounts) home(c *gin.Context, path string) string {
	if origin, ok := a.savedOrigin(c); ok {
		return origin + path
	}
	return path
}

const githubOriginKey = "github_return_origin"

// savedOrigin is the origin takeState read in this same request, if any.
func (a *githubAccounts) savedOrigin(c *gin.Context) (string, bool) {
	value, ok := c.Get(githubOriginKey)
	if !ok {
		return "", false
	}
	origin, ok := value.(string)
	return origin, ok && origin != ""
}

// requestOrigin is the address the browser used, as scheme://host:port.
func requestOrigin(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + c.Request.Host
}

// safeOrigin accepts a return origin only on the same host the callback was
// reached on — another port of localhost, say — so the way home can never be
// someone else's site.
func safeOrigin(c *gin.Context, origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" || u.User != nil {
		return false
	}
	here := c.Request.Host
	if h, _, splitErr := net.SplitHostPort(here); splitErr == nil {
		here = h
	}
	return strings.EqualFold(u.Hostname(), here)
}

// safeReturnPath keeps the return address inside the app, so the callback
// cannot be used to send someone to another site.
func safeReturnPath(path string) string {
	if !strings.HasPrefix(path, "/app") || strings.HasPrefix(path, "//") ||
		strings.Contains(path, "\\") || strings.Contains(path, "://") {
		return defaultReturnPath
	}
	return path
}

func withQuery(path, key, value string) string {
	u, err := url.Parse(path)
	if err != nil {
		return path
	}
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	return u.String()
}
