// Package samples ships a handful of ready-made feature maps (WhatsApp, Uber,
// Spotify…) inside the binary, so anyone running FeaturePlus can import a test
// project without having a file of their own. The maps are plain FEATURES.md
// markdown: the same nested list with "> needs:" the playground reads.
package samples

import (
	"embed"
	"io/fs"
	"sort"
	"strings"
)

//go:embed *.md
var filesFS embed.FS

// Sample names one ready-made feature map, without its contents.
type Sample struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// List returns the available samples, by name.
func List() []Sample {
	entries, err := fs.ReadDir(filesFS, ".")
	if err != nil {
		return nil
	}
	out := make([]Sample, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".md")
		out = append(out, Sample{ID: id, Name: nameOf(id)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Read returns a sample's markdown and whether it exists. The id is checked
// against a strict allow-list first, so it can never reach outside the folder.
func Read(id string) (string, bool) {
	if !safeID(id) {
		return "", false
	}
	b, err := filesFS.ReadFile(id + ".md")
	if err != nil {
		return "", false
	}
	return string(b), true
}

// NameOf is the sample's title, taken from its first "# " heading.
func NameOf(id string) string {
	if !safeID(id) {
		return id
	}
	return nameOf(id)
}

func nameOf(id string) string {
	b, err := filesFS.ReadFile(id + ".md")
	if err != nil {
		return id
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "# ") {
			return strings.TrimSpace(line[2:])
		}
	}
	return id
}

func safeID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_'
		if !ok {
			return false
		}
	}
	return true
}
