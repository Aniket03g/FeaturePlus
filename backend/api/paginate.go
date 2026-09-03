package api

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

// Pagination defaults. PerPage is capped so a client cannot ask for the whole
// table in one request and stall the server.
const (
	DefaultPerPage = 50
	MaxPerPage     = 200
)

// Page is a validated pagination request, parsed from ?page and ?per_page.
type Page struct {
	Number  int
	PerPage int
}

// ParsePage reads pagination from the query string. Out-of-range and
// unparseable values fall back to the defaults rather than erroring: a bad
// page number is not worth failing a read request over.
func ParsePage(c *gin.Context) Page {
	p := Page{Number: 1, PerPage: DefaultPerPage}

	if n, err := strconv.Atoi(c.Query("page")); err == nil && n > 0 {
		p.Number = n
	}

	if n, err := strconv.Atoi(c.Query("per_page")); err == nil && n > 0 {
		if n > MaxPerPage {
			n = MaxPerPage
		}
		p.PerPage = n
	}

	return p
}

// Offset is the number of rows to skip for this page.
func (p Page) Offset() int {
	return (p.Number - 1) * p.PerPage
}

// Limit is the number of rows to fetch.
func (p Page) Limit() int {
	return p.PerPage
}

// Meta builds the response metadata for a page, given the total row count.
func (p Page) Meta(total int64) Meta {
	totalPages := 0
	if p.PerPage > 0 {
		totalPages = int((total + int64(p.PerPage) - 1) / int64(p.PerPage))
	}

	return Meta{
		Total:      total,
		Page:       p.Number,
		PerPage:    p.PerPage,
		TotalPages: totalPages,
	}
}

// Slice applies the page to an already-loaded slice.
//
// The repositories currently load whole tables, so paginating in memory is the
// honest option: it gives clients a stable contract now, and each repository
// can move to a LIMIT/OFFSET query later without the API shape changing.
func Slice[T any](items []T, p Page) []T {
	start := p.Offset()
	if start >= len(items) {
		return []T{}
	}

	end := start + p.Limit()
	if end > len(items) {
		end = len(items)
	}

	return items[start:end]
}

// IDParam reads a positive integer path parameter, such as :id.
func IDParam(c *gin.Context, name string) (int, error) {
	raw := c.Param(name)

	id, err := strconv.Atoi(raw)
	if err != nil || id <= 0 {
		return 0, BadRequest("Invalid " + name + ": expected a positive integer")
	}

	return id, nil
}
