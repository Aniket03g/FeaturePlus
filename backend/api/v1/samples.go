package v1

import (
	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/samples"
	"github.com/gin-gonic/gin"
)

// Sample feature maps that ship with the server, for importing a test project.
// Anyone signed in may read them; they hold no project data of their own.

// registerSampleRoutes mounts the sample-map endpoints.
func registerSampleRoutes(g *gin.RouterGroup) {
	g.GET("/samples", listSamplesHandler)
	g.GET("/samples/:id", getSampleHandler)
}

// listSamplesHandler lists the available sample feature maps.
//
// GET /api/v1/samples
func listSamplesHandler(c *gin.Context) {
	list := samples.List()
	if list == nil {
		list = []samples.Sample{}
	}
	api.OK(c, list)
}

// SampleContentDTO is a sample map with its markdown.
type SampleContentDTO struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Markdown string `json:"markdown"`
}

// getSampleHandler returns one sample map's markdown, to load into the playground.
//
// GET /api/v1/samples/:id
func getSampleHandler(c *gin.Context) {
	id := c.Param("id")
	md, ok := samples.Read(id)
	if !ok {
		api.Fail(c, api.NotFound("Sample"))
		return
	}
	api.OK(c, SampleContentDTO{ID: id, Name: samples.NameOf(id), Markdown: md})
}
