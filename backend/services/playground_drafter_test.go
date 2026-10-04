package services

import (
	"context"
	"testing"
)

func draft(t *testing.T, prompt string, current []DraftFeature) DraftReply {
	t.Helper()
	reply, err := StandInDrafter{}.Draft(context.Background(), DraftRequest{Prompt: prompt, Current: current})
	if err != nil {
		t.Fatalf("draft: %v", err)
	}
	reply.Features = CleanDraft(reply.Features)
	return reply
}

// byTitle indexes a draft, and names each row's parent and needs by title so
// a test reads the way the list does.
type row struct {
	parent string
	needs  map[string]bool
}

func byTitle(features []DraftFeature) map[string]row {
	names := map[string]string{}
	for _, f := range features {
		names[f.Key] = f.Title
	}
	out := map[string]row{}
	for _, f := range features {
		needs := map[string]bool{}
		for _, n := range f.Needs {
			needs[names[n]] = true
		}
		out[f.Title] = row{parent: names[f.ParentKey], needs: needs}
	}
	return out
}

func TestStandInDraftsAnIdea(t *testing.T) {
	reply := draft(t, "I want to build a hiking app with trails, offline maps and group trips", nil)
	rows := byTitle(reply.Features)

	if reply.Title != "Hiking app" {
		t.Errorf("title %q, want Hiking app", reply.Title)
	}
	for _, name := range []string{"Trails", "Offline maps", "Group trips", "Accounts", "Sign in"} {
		if _, ok := rows[name]; !ok {
			t.Errorf("missing %q in %v", name, rows)
		}
	}
	if rows["Map view"].parent != "Offline maps" {
		t.Errorf("Map view should sit inside Offline maps, got %q", rows["Map view"].parent)
	}
	if !rows["Place search"].needs["Map view"] {
		t.Errorf("Place search should need Map view: %v", rows["Place search"].needs)
	}
	if !rows["Trails"].needs["Sign in"] {
		t.Errorf("Trails should need Sign in: %v", rows["Trails"].needs)
	}
	if rows["Sign in"].parent != "Accounts" {
		t.Errorf("Sign in should sit inside Accounts")
	}
	if reply.Features[0].Title != "Accounts" {
		t.Errorf("Accounts should come first, got %q", reply.Features[0].Title)
	}
}

func TestStandInFollowsInstructions(t *testing.T) {
	first := draft(t, "a recipe app with recipes, shopping lists and reviews", nil)
	keys := map[string]string{}
	for _, f := range first.Features {
		keys[f.Title] = f.Key
	}

	next := draft(t, "put Shopping lists inside Recipes; rename Reviews to Feedback; Recipes needs Profiles. add Tags under Recipes", first.Features)
	rows := byTitle(next.Features)

	if rows["Shopping lists"].parent != "Recipes" {
		t.Errorf("Shopping lists parent %q, want Recipes", rows["Shopping lists"].parent)
	}
	if _, ok := rows["Feedback"]; !ok {
		t.Errorf("Reviews was not renamed: %v", rows)
	}
	if !rows["Recipes"].needs["Profiles"] {
		t.Errorf("Recipes should need Profiles: %v", rows["Recipes"].needs)
	}
	if rows["Tags"].parent != "Recipes" {
		t.Errorf("Tags parent %q, want Recipes", rows["Tags"].parent)
	}
	// Rows it kept keep their keys, so the playground keeps their ticks and releases.
	for _, f := range next.Features {
		if f.Title == "Recipes" && f.Key != keys["Recipes"] {
			t.Errorf("Recipes changed key from %s to %s", keys["Recipes"], f.Key)
		}
	}

	removed := draft(t, "remove Recipes", next.Features)
	for _, f := range removed.Features {
		if f.Title == "Recipes" || f.Title == "Tags" || f.Title == "Shopping lists" {
			t.Errorf("%q should have gone with Recipes", f.Title)
		}
	}
}

func TestStandInAddsToAList(t *testing.T) {
	first := draft(t, "a notes app with folders", nil)
	next := draft(t, "it should also have chat and sharing", first.Features)
	rows := byTitle(next.Features)
	for _, name := range []string{"Chat", "Sharing", "Conversations"} {
		if _, ok := rows[name]; !ok {
			t.Errorf("missing %q: %v", name, rows)
		}
	}
	if next.Title != "" {
		t.Errorf("a follow-up should not rename the list, got %q", next.Title)
	}
}

func TestStandInSaysWhenItDidNotUnderstand(t *testing.T) {
	reply := draft(t, "hmm", nil)
	if len(reply.Features) != 0 {
		t.Errorf("want nothing drafted, got %v", reply.Features)
	}
	if reply.Message == "" {
		t.Error("want a message saying what to try")
	}
}

func TestCleanDraftRepairsABadAnswer(t *testing.T) {
	clean := CleanDraft([]DraftFeature{
		{Key: "c", Title: "Child", ParentKey: "p", Needs: []string{"p", "c", "ghost", "b"}},
		{Key: "p", Title: "Parent", Needs: []string{"c"}},
		{Key: "b", Title: " Billing ", ParentKey: "missing"},
		{Key: "b2", Title: "billing"},
		{Key: "x", Title: "Uses the duplicate", Needs: []string{"b2", "b"}},
		{Key: "", Title: "No key"},
		{Key: "e", Title: "  "},
		{Key: "l1", Title: "Loop one", ParentKey: "l2"},
		{Key: "l2", Title: "Loop two", ParentKey: "l1"},
	})
	rows := byTitle(clean)

	if len(clean) != 6 {
		t.Fatalf("want 6 rows, got %d: %v", len(clean), clean)
	}
	if clean[0].Title != "Parent" || clean[1].Title != "Child" {
		t.Errorf("parents should come first: %v", clean)
	}
	if got := rows["Child"].needs; len(got) != 1 || !got["Billing"] {
		t.Errorf("Child needs %v, want only Billing", got)
	}
	if len(rows["Parent"].needs) != 0 {
		t.Errorf("a parent must not need its own part: %v", rows["Parent"].needs)
	}
	if rows["Billing"].parent != "" {
		t.Errorf("an unknown parent should be cleared")
	}
	if got := rows["Uses the duplicate"].needs; len(got) != 1 || !got["Billing"] {
		t.Errorf("a need on a duplicate should point at the first, once: %v", got)
	}
	if rows["Loop one"].parent != "" && rows["Loop two"].parent != "" {
		t.Errorf("a nesting loop should be broken: %v", rows)
	}
}
