package services

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// GitHubClient is the handful of GitHub REST calls FeaturePlus needs to copy a
// project's plan into a repository and announce its releases: read a repo,
// read and write one file, and create a release.
//
// Its token is a person's own, from connecting through the FeaturePlus GitHub
// App (see GitHubApp.UserClient). Everything goes through the REST API, so
// nothing is cloned and no git binary is needed.
type GitHubClient struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// ErrGitHubNotFound is a 404 from GitHub: the repository, file or branch is
// not there, or the token cannot see it — GitHub does not say which.
var ErrGitHubNotFound = errors.New("not found on GitHub")

// GitHubError is any other failure GitHub reported, with its own message.
type GitHubError struct {
	Status  int
	Message string
}

func (e *GitHubError) Error() string {
	return fmt.Sprintf("GitHub answered %d: %s", e.Status, e.Message)
}

// GitHubRepo is the part of a repository FeaturePlus reads.
type GitHubRepo struct {
	FullName      string `json:"full_name"`
	HTMLURL       string `json:"html_url"`
	DefaultBranch string `json:"default_branch"`
	Permissions   struct {
		Push bool `json:"push"`
	} `json:"permissions"`
}

// GetRepo reads a repository.
func (c *GitHubClient) GetRepo(owner, repo string) (*GitHubRepo, error) {
	var out GitHubRepo
	if err := c.call(http.MethodGet, repoPath(owner, repo), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetFile reads a file on a branch and returns its text and blob SHA. A file
// that does not exist yet is ErrGitHubNotFound.
func (c *GitHubClient) GetFile(owner, repo, path, branch string) (content, sha string, err error) {
	var out struct {
		SHA      string `json:"sha"`
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	endpoint := repoPath(owner, repo) + "/contents/" + escapePath(path) + "?ref=" + url.QueryEscape(branch)
	if err := c.call(http.MethodGet, endpoint, nil, &out); err != nil {
		return "", "", err
	}
	if out.Encoding != "base64" {
		return "", out.SHA, nil
	}
	raw, decodeErr := base64.StdEncoding.DecodeString(strings.ReplaceAll(out.Content, "\n", ""))
	if decodeErr != nil {
		return "", out.SHA, nil
	}
	return string(raw), out.SHA, nil
}

// PutFile creates or replaces a file with one commit and returns the commit's
// SHA. sha is the file's current blob SHA, or empty to create it.
func (c *GitHubClient) PutFile(owner, repo, path, branch, content, message, sha string) (string, error) {
	body := map[string]any{
		"message": message,
		"content": base64.StdEncoding.EncodeToString([]byte(content)),
		"branch":  branch,
	}
	if sha != "" {
		body["sha"] = sha
	}
	var out struct {
		Commit struct {
			SHA string `json:"sha"`
		} `json:"commit"`
	}
	if err := c.call(http.MethodPut, repoPath(owner, repo)+"/contents/"+escapePath(path), body, &out); err != nil {
		return "", err
	}
	return out.Commit.SHA, nil
}

// CreateRelease makes a GitHub Release. GitHub creates the tag with it, on the
// tip of target, when the tag does not exist yet.
func (c *GitHubClient) CreateRelease(owner, repo, tag, target, name, notes string) (string, error) {
	body := map[string]any{
		"tag_name":         tag,
		"target_commitish": target,
		"name":             name,
		"body":             notes,
	}
	var out struct {
		HTMLURL string `json:"html_url"`
	}
	if err := c.call(http.MethodPost, repoPath(owner, repo)+"/releases", body, &out); err != nil {
		return "", err
	}
	return out.HTMLURL, nil
}

// GetReleaseByTag finds an existing GitHub Release for a tag.
func (c *GitHubClient) GetReleaseByTag(owner, repo, tag string) (string, error) {
	var out struct {
		HTMLURL string `json:"html_url"`
	}
	if err := c.call(http.MethodGet, repoPath(owner, repo)+"/releases/tags/"+url.PathEscape(tag), nil, &out); err != nil {
		return "", err
	}
	return out.HTMLURL, nil
}

func (c *GitHubClient) call(method, endpoint string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequest(method, strings.TrimRight(c.BaseURL, "/")+endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "FeaturePlus")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))

	if resp.StatusCode == http.StatusNotFound {
		return ErrGitHubNotFound
	}
	if resp.StatusCode >= 300 {
		return &GitHubError{Status: resp.StatusCode, Message: githubMessage(raw)}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// githubMessage pulls the readable part out of a GitHub error body, including
// the first detailed reason when there is one ("already_exists").
func githubMessage(raw []byte) string {
	var body struct {
		Message string `json:"message"`
		Errors  []struct {
			Code    string `json:"code"`
			Field   string `json:"field"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Message == "" {
		return strings.TrimSpace(string(raw))
	}
	if len(body.Errors) > 0 {
		detail := body.Errors[0].Message
		if detail == "" {
			detail = strings.TrimSpace(body.Errors[0].Field + " " + body.Errors[0].Code)
		}
		if detail != "" {
			return body.Message + " (" + detail + ")"
		}
	}
	return body.Message
}

func repoPath(owner, repo string) string {
	return "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo)
}

// escapePath escapes each segment of a file path but keeps its slashes.
func escapePath(path string) string {
	parts := strings.Split(path, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}
