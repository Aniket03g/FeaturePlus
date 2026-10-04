package services

import (
	"context"
	"regexp"
	"strconv"
	"strings"
)

// Drafter turns a request in plain words into a draft feature list for the
// playground: "a hiking app with trails, offline maps and group trips", or a
// follow-up such as "put Reviews inside Trails".
//
// A drafter always answers with the whole list, not a change to it, so the
// playground can put the answer in place of its draft and undo it in one step.
// Rows it keeps carry their key forward; rows it adds get new keys. Needs are
// its guesses at "this cannot start until that is finished", and the
// playground shows them as suggestions until someone confirms them.
//
// The stand-in below answers without a model. A real one sends the same
// request to a model that is made to answer in this shape, and nothing else
// changes.
type Drafter interface {
	// Name is how the playground labels the answer, so a stand-in is never
	// mistaken for the real thing.
	Name() string
	Draft(ctx context.Context, req DraftRequest) (DraftReply, error)
}

// DraftFeature is one row of a draft. ParentKey nests it; Needs names the rows
// it depends on, by key.
type DraftFeature struct {
	Key       string   `json:"key"`
	Title     string   `json:"title"`
	ParentKey string   `json:"parent_key"`
	Needs     []string `json:"needs"`
}

// DraftRequest is what the person typed and the list as it stands.
type DraftRequest struct {
	Prompt  string
	Current []DraftFeature
}

// DraftReply is the revised list. Title is a suggested name for the list,
// empty to keep the one it has; Message is a sentence or two saying what changed.
type DraftReply struct {
	Title    string         `json:"title"`
	Message  string         `json:"message"`
	Features []DraftFeature `json:"features"`
}

// ---------- cleaning up any drafter's answer ----------

// maxDraftTitle matches the feature title column, so a draft always imports.
const maxDraftTitle = 255

// CleanDraft makes a drafter's answer safe to hand to the playground, whoever
// wrote it: a model can return a parent that is not in the list or a name
// twice, and the playground should never have to cope with that.
//
// Rows without a name are dropped. A second row with a name already used is
// dropped and anything pointing at it points at the first. A parent that is
// missing, or that would put a row inside itself, is cleared. A need that is
// missing, points at the row itself, or points up or down its own nesting is
// dropped: a feature does not wait on its own parts, and nesting already says
// they belong together. The list comes back parents first, each followed by
// everything inside it, which is the order the playground keeps.
func CleanDraft(rows []DraftFeature) []DraftFeature {
	seenKey := map[string]bool{}
	byName := map[string]string{}
	alias := map[string]string{}
	kept := make([]DraftFeature, 0, len(rows))

	for _, row := range rows {
		title := strings.TrimSpace(row.Title)
		if len(title) > maxDraftTitle {
			title = title[:maxDraftTitle]
		}
		key := strings.TrimSpace(row.Key)
		if title == "" || key == "" || seenKey[key] {
			continue
		}
		seenKey[key] = true
		name := strings.ToLower(title)
		if first, dup := byName[name]; dup {
			alias[key] = first
			continue
		}
		byName[name] = key
		kept = append(kept, DraftFeature{Key: key, Title: title, ParentKey: row.ParentKey, Needs: row.Needs})
	}

	resolve := func(key string) string {
		if first, ok := alias[key]; ok {
			return first
		}
		return key
	}
	index := map[string]int{}
	for i, row := range kept {
		index[row.Key] = i
	}

	// Parents: known, and never a loop back to the row itself.
	for i := range kept {
		parent := resolve(kept[i].ParentKey)
		if _, ok := index[parent]; !ok || parent == kept[i].Key {
			parent = ""
		}
		kept[i].ParentKey = parent
	}
	for i := range kept {
		seen := map[string]bool{kept[i].Key: true}
		for p := kept[i].ParentKey; p != ""; p = kept[index[p]].ParentKey {
			if seen[p] {
				kept[i].ParentKey = ""
				break
			}
			seen[p] = true
		}
	}

	ancestors := func(key string) map[string]bool {
		out := map[string]bool{}
		for p := kept[index[key]].ParentKey; p != ""; p = kept[index[p]].ParentKey {
			out[p] = true
		}
		return out
	}

	for i := range kept {
		mine := ancestors(kept[i].Key)
		needs := []string{}
		seen := map[string]bool{}
		for _, raw := range kept[i].Needs {
			need := resolve(raw)
			if _, ok := index[need]; !ok || need == kept[i].Key || seen[need] || mine[need] {
				continue
			}
			if ancestors(need)[kept[i].Key] {
				continue
			}
			seen[need] = true
			needs = append(needs, need)
		}
		kept[i].Needs = needs
	}

	// Parents first, each followed by its children, in the order given.
	children := map[string][]DraftFeature{}
	for _, row := range kept {
		children[row.ParentKey] = append(children[row.ParentKey], row)
	}
	ordered := make([]DraftFeature, 0, len(kept))
	var walk func(parent string)
	walk = func(parent string) {
		for _, row := range children[parent] {
			ordered = append(ordered, row)
			walk(row.Key)
		}
	}
	walk("")
	return ordered
}

// ---------- the stand-in ----------

// StandInDrafter answers without a model, so the playground's prompt can be
// built and tried before there is an API key. It understands a handful of
// sentence shapes and knows the usual parts of a few kinds of feature; it does
// not understand anything else, and says so.
type StandInDrafter struct{}

// Name labels the answers.
func (StandInDrafter) Name() string { return "stand-in" }

// Draft reads the prompt a clause at a time: an instruction ("add", "remove",
// "rename", "put … inside …", "… needs …") changes the list, and anything else
// is read as a description of features to add.
func (StandInDrafter) Draft(_ context.Context, req DraftRequest) (DraftReply, error) {
	d := newStandInDraft(req.Current)
	fresh := len(req.Current) == 0

	title := ""
	for _, clause := range splitClauses(req.Prompt) {
		if d.instruction(clause) {
			continue
		}
		subject, parts := splitIdea(clause, fresh && title == "")
		if subject != "" && title == "" && fresh {
			title = subject
		}
		d.addIdea(subject, parts)
	}

	if fresh && len(d.added) > 0 {
		d.addAccounts()
	}

	return DraftReply{Title: title, Message: d.summary(fresh), Features: d.rows}, nil
}

// standInDraft is the list being worked on, with names looked up ignoring case.
type standInDraft struct {
	rows   []DraftFeature
	next   int
	added  []string
	notes  []string
	needed int
}

func newStandInDraft(current []DraftFeature) *standInDraft {
	d := &standInDraft{}
	for _, row := range current {
		copied := row
		copied.Needs = append([]string{}, row.Needs...)
		d.rows = append(d.rows, copied)
	}
	return d
}

func (d *standInDraft) find(name string) int {
	want := strings.ToLower(strings.TrimSpace(name))
	for i, row := range d.rows {
		if strings.ToLower(row.Title) == want {
			return i
		}
	}
	return -1
}

func (d *standInDraft) newKey() string {
	for {
		d.next++
		key := "ai" + strconv.Itoa(d.next)
		taken := false
		for _, row := range d.rows {
			if row.Key == key {
				taken = true
				break
			}
		}
		if !taken {
			return key
		}
	}
}

// add returns the key of the row with this name, creating it when there is none.
func (d *standInDraft) add(title, parent string) string {
	if i := d.find(title); i >= 0 {
		return d.rows[i].Key
	}
	key := d.newKey()
	d.rows = append(d.rows, DraftFeature{Key: key, Title: title, ParentKey: parent, Needs: []string{}})
	d.added = append(d.added, title)
	return key
}

func (d *standInDraft) need(from, on string) {
	i := d.indexOf(from)
	if i < 0 || from == on {
		return
	}
	for _, existing := range d.rows[i].Needs {
		if existing == on {
			return
		}
	}
	d.rows[i].Needs = append(d.rows[i].Needs, on)
	d.needed++
}

func (d *standInDraft) indexOf(key string) int {
	for i, row := range d.rows {
		if row.Key == key {
			return i
		}
	}
	return -1
}

var (
	addPattern     = regexp.MustCompile(`(?i)^(?:please\s+)?(?:add|include)\s+(.+?)(?:\s+(?:inside|into|under|to|in)\s+(.+))?$`)
	removePattern  = regexp.MustCompile(`(?i)^(?:please\s+)?(?:remove|delete|drop)\s+(.+)$`)
	renamePattern  = regexp.MustCompile(`(?i)^(?:please\s+)?rename\s+(.+?)\s+to\s+(.+)$`)
	movePattern    = regexp.MustCompile(`(?i)^(?:please\s+)?(?:move|put|nest)\s+(.+?)\s+(?:inside|into|under|in)\s+(.+)$`)
	topPattern     = regexp.MustCompile(`(?i)^(?:please\s+)?(?:move|take)\s+(.+?)\s+(?:to the top level|out(?: of .+)?)$`)
	unneedPattern  = regexp.MustCompile(`(?i)^(.+?)\s+(?:no longer needs|does not need|doesn't need|does not depend on|doesn't depend on)\s+(.+)$`)
	needPattern    = regexp.MustCompile(`(?i)^(.+?)\s+(?:needs|requires|depends on|comes after|waits for)\s+(.+)$`)
	ideaPattern    = regexp.MustCompile(`(?i)^(?:i\s+(?:want|would like|need)\s+(?:to\s+(?:build|make|create)\s+)?|(?:build|make|create|design)\s+(?:me\s+)?)?(?:an?\s+|the\s+)?(.+?)\s+(?:with|that has|that have|which has|featuring|including|where people can|that lets people)\s+(.+)$`)
	leadingPattern = regexp.MustCompile(`(?i)^(?:i\s+(?:want|would like|need)\s+(?:to\s+(?:build|make|create)\s+)?|(?:build|make|create|design)\s+(?:me\s+)?)?(?:an?\s+|the\s+)?`)
	listSplit      = regexp.MustCompile(`(?i)\s*(?:,|\band also\b|\band\b|&|\bplus\b)\s*`)
	articles       = regexp.MustCompile(`(?i)^(?:an?|the|some|also)\s+`)
	addVerb        = regexp.MustCompile(`(?i)^(?:please\s+)?(?:add|include)\s+`)
	fillerPattern  = regexp.MustCompile(`(?i)^(?:(?:it|they|this|we|people|users)\s+)?(?:should\s+|must\s+|will\s+|would\s+|can\s+)?(?:also\s+)?(?:have|has|need|needs|include|includes|support|supports|want|be able to use)\s+`)
)

// instruction applies a clause that is an edit to the list, and says whether it was one.
func (d *standInDraft) instruction(clause string) bool {
	if m := renamePattern.FindStringSubmatch(clause); m != nil {
		if i := d.find(m[1]); i >= 0 {
			d.rows[i].Title = tidyName(m[2])
			d.notes = append(d.notes, "renamed "+strings.TrimSpace(m[1])+" to "+d.rows[i].Title)
			return true
		}
	}
	if m := movePattern.FindStringSubmatch(clause); m != nil {
		i, parent := d.find(m[1]), d.find(m[2])
		if i >= 0 && parent >= 0 && i != parent {
			d.rows[i].ParentKey = d.rows[parent].Key
			d.notes = append(d.notes, "put "+d.rows[i].Title+" inside "+d.rows[parent].Title)
			return true
		}
	}
	if m := topPattern.FindStringSubmatch(clause); m != nil {
		if i := d.find(m[1]); i >= 0 {
			d.rows[i].ParentKey = ""
			d.notes = append(d.notes, "moved "+d.rows[i].Title+" to the top level")
			return true
		}
	}
	if m := removePattern.FindStringSubmatch(clause); m != nil {
		removed := []string{}
		for _, name := range splitList(m[1]) {
			if i := d.find(name); i >= 0 {
				removed = append(removed, d.rows[i].Title)
				d.remove(d.rows[i].Key)
			}
		}
		if len(removed) > 0 {
			d.notes = append(d.notes, "removed "+joinNames(removed)+" and anything inside")
			return true
		}
	}
	if m := unneedPattern.FindStringSubmatch(clause); m != nil {
		if i := d.find(m[1]); i >= 0 {
			for _, name := range splitList(m[2]) {
				if j := d.find(name); j >= 0 {
					d.rows[i].Needs = without(d.rows[i].Needs, d.rows[j].Key)
				}
			}
			d.notes = append(d.notes, "took those dependencies off "+d.rows[i].Title)
			return true
		}
	}
	if m := needPattern.FindStringSubmatch(clause); m != nil {
		if i := d.find(m[1]); i >= 0 {
			for _, name := range splitList(m[2]) {
				key := d.add(tidyName(name), "")
				d.need(d.rows[i].Key, key)
			}
			return true
		}
	}
	if m := addPattern.FindStringSubmatch(clause); m != nil {
		parent := ""
		names := m[1]
		if m[2] != "" {
			if p := d.find(m[2]); p >= 0 {
				parent = d.rows[p].Key
			} else {
				// Not a feature in the list, so the words were part of the name.
				names = addVerb.ReplaceAllString(clause, "")
			}
		}
		for _, name := range splitList(names) {
			d.addPart(tidyName(name), parent)
		}
		return true
	}
	return false
}

func (d *standInDraft) remove(key string) {
	gone := map[string]bool{key: true}
	for changed := true; changed; {
		changed = false
		for _, row := range d.rows {
			if !gone[row.Key] && gone[row.ParentKey] {
				gone[row.Key] = true
				changed = true
			}
		}
	}
	kept := d.rows[:0]
	for _, row := range d.rows {
		if gone[row.Key] {
			continue
		}
		needs := []string{}
		for _, n := range row.Needs {
			if !gone[n] {
				needs = append(needs, n)
			}
		}
		row.Needs = needs
		kept = append(kept, row)
	}
	d.rows = kept
}

// addIdea adds the parts a description names, each with the usual pieces of
// that kind of feature. With no parts named, the subject is looked up the same
// way, so "an online shop" still gets a cart and a checkout.
func (d *standInDraft) addIdea(subject string, parts []string) {
	if len(parts) == 0 && subject != "" {
		if !d.addKnown(subject, "") {
			d.notes = append(d.notes, "could not pick features out of \""+subject+"\"")
		}
		return
	}
	for _, part := range parts {
		d.addPart(tidyName(part), "")
	}
}

// addPart adds one named feature and the usual pieces inside it.
func (d *standInDraft) addPart(name, parent string) {
	if name == "" {
		return
	}
	key := d.add(name, parent)
	d.addKnown(name, key)
}

// known is what the stand-in knows: words that suggest a kind of feature, and
// the pieces that kind usually has, with the order they depend on each other.
var known = []struct {
	words []string
	parts []struct{ name, needs string }
}{
	{[]string{"map"}, []struct{ name, needs string }{{"Map view", ""}, {"Place search", "Map view"}}},
	{[]string{"offline"}, []struct{ name, needs string }{{"Download for offline", ""}, {"Sync when back online", "Download for offline"}}},
	{[]string{"chat", "messag"}, []struct{ name, needs string }{{"Conversations", ""}, {"Message notifications", "Conversations"}}},
	{[]string{"shop", "store", "checkout", "cart", "payment", "sell"}, []struct{ name, needs string }{{"Cart", ""}, {"Payment", "Cart"}, {"Receipts", "Payment"}}},
	{[]string{"group", "team", "trip", "event"}, []struct{ name, needs string }{{"Invite people", ""}, {"Shared schedule", "Invite people"}}},
	{[]string{"review", "rating"}, []struct{ name, needs string }{{"Write a review", ""}, {"Star ratings", ""}}},
	{[]string{"photo", "image", "picture"}, []struct{ name, needs string }{{"Photo upload", ""}, {"Gallery", "Photo upload"}}},
	{[]string{"booking", "appointment", "reservation"}, []struct{ name, needs string }{{"Availability", ""}, {"Book a slot", "Availability"}, {"Reminders", "Book a slot"}}},
	{[]string{"dashboard", "report", "analytics"}, []struct{ name, needs string }{{"Charts", ""}, {"Export", "Charts"}}},
	{[]string{"search"}, []struct{ name, needs string }{{"Filters", ""}}},
	{[]string{"notification", "alert"}, []struct{ name, needs string }{{"Notification settings", ""}}},
}

// addKnown adds the usual pieces for a name. With a parent they go inside it;
// without one they go at the top level. It says whether it knew anything.
func (d *standInDraft) addKnown(name, parent string) bool {
	lower := strings.ToLower(name)
	found := false
	for _, kind := range known {
		match := false
		for _, word := range kind.words {
			if strings.Contains(lower, word) {
				match = true
				break
			}
		}
		if !match {
			continue
		}
		found = true
		keys := map[string]string{}
		for _, part := range kind.parts {
			keys[part.name] = d.add(part.name, parent)
		}
		for _, part := range kind.parts {
			if part.needs != "" {
				d.need(keys[part.name], keys[part.needs])
			}
		}
	}
	return found
}

// addAccounts gives a new product the sign-in almost every product needs,
// and suggests that the features people use need it.
func (d *standInDraft) addAccounts() {
	for _, name := range []string{"accounts", "sign in", "login", "log in"} {
		if d.find(name) >= 0 {
			return
		}
	}
	top := []string{}
	for _, row := range d.rows {
		if row.ParentKey == "" {
			top = append(top, row.Key)
		}
	}
	accounts := d.add("Accounts", "")
	d.add("Sign up", accounts)
	signIn := d.add("Sign in", accounts)
	d.add("Profiles", accounts)
	for _, key := range top {
		d.need(key, signIn)
	}
	// Accounts goes first in the list: it is what everything else waits on.
	moved := []DraftFeature{}
	rest := []DraftFeature{}
	for _, row := range d.rows {
		if row.Key == accounts || row.ParentKey == accounts {
			moved = append(moved, row)
		} else {
			rest = append(rest, row)
		}
	}
	d.rows = append(moved, rest...)
}

func (d *standInDraft) summary(fresh bool) string {
	parts := []string{}
	if len(d.added) > 0 {
		verb := "Added "
		if fresh {
			verb = "Here is a first draft: "
		}
		parts = append(parts, verb+countOf(len(d.added), "feature")+".")
	}
	for _, note := range d.notes {
		parts = append(parts, strings.ToUpper(note[:1])+note[1:]+".")
	}
	if d.needed > 0 {
		parts = append(parts, "I suggested "+countOf(d.needed, "dependency")+"; they stay dashed until you confirm them.")
	}
	if len(parts) == 0 {
		return "I did not understand that. Describe the product and its parts (\"a notes app with folders, sharing and search\"), or say what to change (\"add Tags inside Notes\", \"Sharing needs Folders\")."
	}
	return strings.Join(parts, " ")
}

// ---------- reading sentences ----------

// splitClauses cuts a prompt at line breaks, semicolons and full stops, so
// several instructions can be given at once.
func splitClauses(prompt string) []string {
	cut := regexp.MustCompile(`[\r\n;]+|\.\s+|\.$`).Split(strings.TrimSpace(prompt), -1)
	out := []string{}
	for _, clause := range cut {
		clause = strings.Trim(strings.TrimSpace(clause), ".!?")
		if clause != "" {
			out = append(out, clause)
		}
	}
	return out
}

// splitIdea reads "a hiking app with trails, offline maps and group trips" as
// the subject "Hiking app" and its parts. A clause without "with" is all
// subject when it describes a new product, and all parts when it adds to one.
func splitIdea(clause string, describesProduct bool) (string, []string) {
	if m := ideaPattern.FindStringSubmatch(clause); m != nil {
		return tidyName(m[1]), splitList(m[2])
	}
	if describesProduct && !fillerPattern.MatchString(clause) {
		return tidyName(leadingPattern.ReplaceAllString(clause, "")), nil
	}
	return "", splitList(fillerPattern.ReplaceAllString(clause, ""))
}

func splitList(text string) []string {
	out := []string{}
	for _, part := range listSplit.Split(text, -1) {
		part = strings.TrimSpace(articles.ReplaceAllString(strings.TrimSpace(part), ""))
		part = strings.Trim(part, " .!?\"'")
		if part != "" && len(out) < 20 {
			out = append(out, part)
		}
	}
	return out
}

// tidyName trims a name and gives it a capital first letter.
func tidyName(name string) string {
	name = strings.Trim(strings.TrimSpace(articles.ReplaceAllString(strings.TrimSpace(name), "")), " .!?\"'")
	if name == "" {
		return ""
	}
	return strings.ToUpper(name[:1]) + name[1:]
}

func without(keys []string, drop string) []string {
	out := []string{}
	for _, k := range keys {
		if k != drop {
			out = append(out, k)
		}
	}
	return out
}

func joinNames(names []string) string {
	if len(names) <= 1 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

func countOf(n int, noun string) string {
	if n == 1 {
		return "1 " + noun
	}
	if strings.HasSuffix(noun, "y") {
		return strconv.Itoa(n) + " " + noun[:len(noun)-1] + "ies"
	}
	return strconv.Itoa(n) + " " + noun + "s"
}
