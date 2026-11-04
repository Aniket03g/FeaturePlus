package v1

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"strings"
	"time"

	"github.com/FeaturePlus/backend/api"
	"github.com/FeaturePlus/backend/internal/log"
	"github.com/FeaturePlus/backend/models"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Invite codes: signing up needs one. Admins make them and share them
// offline. Each lets one account be created, within inviteLifetime, by the
// email it was made for if one was given. See models.InviteCode.

const inviteLifetime = 7 * 24 * time.Hour

// inviteAlphabet leaves out characters that are easy to misread aloud or
// copy wrongly by hand: 0/O, 1/I/L.
const inviteAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// newInviteCode is twelve random characters in three groups: XKCD-7Q2M-PLW4.
func newInviteCode() (string, error) {
	var b strings.Builder
	for i := 0; i < 12; i++ {
		if i > 0 && i%4 == 0 {
			b.WriteByte('-')
		}
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(inviteAlphabet))))
		if err != nil {
			return "", err
		}
		b.WriteByte(inviteAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// normalizeInviteCode reads a code as people type it: any case, with or
// without the dashes, with stray spaces.
func normalizeInviteCode(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(raw) {
		if strings.ContainsRune(inviteAlphabet, r) || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func hashInviteCode(raw string) string {
	sum := sha256.Sum256([]byte(normalizeInviteCode(raw)))
	return hex.EncodeToString(sum[:])
}

// InviteDTO describes a code without the code itself.
type InviteDTO struct {
	ID        uint       `json:"id"`
	Hint      string     `json:"hint"`
	Email     string     `json:"email"`
	Note      string     `json:"note"`
	Status    string     `json:"status"` // active, used, expired or cancelled
	CreatedBy string     `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at"`
	UsedBy    string     `json:"used_by"`
}

// CreatedInviteDTO is a new code, the one time it is shown whole.
type CreatedInviteDTO struct {
	InviteDTO
	Code string `json:"code"`
}

// CreateInviteRequest is the accepted body for making a code.
type CreateInviteRequest struct {
	Email string `json:"email" binding:"omitempty,email,max=254"`
	Note  string `json:"note" binding:"max=200"`
}

func inviteStatus(inv models.InviteCode, now time.Time) string {
	switch {
	case inv.UsedAt != nil:
		return "used"
	case inv.CancelledAt != nil:
		return "cancelled"
	case !now.Before(inv.ExpiresAt):
		return "expired"
	default:
		return "active"
	}
}

func registerInviteRoutes(g *gin.RouterGroup, db *gorm.DB) {
	g.GET("/invites", listInvitesHandler(db))
	g.POST("/invites", createInviteHandler(db))
	g.DELETE("/invites/:inviteId", cancelInviteHandler(db))
}

// createInviteHandler makes a code. Admins only.
//
// POST /api/v1/invites
func createInviteHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !api.IsAdmin(c) {
			api.Fail(c, api.Forbidden("Only an admin can make invite codes"))
			return
		}
		userID, err := api.UserID(c)
		if err != nil {
			api.Fail(c, err)
			return
		}
		var req CreateInviteRequest
		if err := api.Bind(c, &req); err != nil {
			api.Fail(c, err)
			return
		}
		email := strings.ToLower(strings.TrimSpace(req.Email))
		if email != "" {
			var taken int64
			if err := db.Model(&models.User{}).Where("LOWER(email) = ?", email).Count(&taken).Error; err != nil {
				api.Fail(c, api.Internal(err))
				return
			}
			if taken > 0 {
				api.Fail(c, api.Conflict("That email already has an account").
					WithField("email", "Already has an account"))
				return
			}
		}

		code, err := newInviteCode()
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		now := time.Now()
		inv := models.InviteCode{
			CodeHash: hashInviteCode(code), Hint: code[len(code)-4:], Email: email,
			Note: strings.TrimSpace(req.Note), CreatedByID: userID,
			ExpiresAt: now.Add(inviteLifetime), CreatedAt: now,
		}
		if err := db.Create(&inv).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		log.WithField("invite", inv.ID).WithField("admin_id", userID).Info("invite code made")

		dtos, err := inviteDTOs(db, []models.InviteCode{inv})
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.Created(c, CreatedInviteDTO{InviteDTO: dtos[0], Code: code})
	}
}

// listInvitesHandler lists every code, newest first. Admins only.
//
// GET /api/v1/invites
func listInvitesHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !api.IsAdmin(c) {
			api.Fail(c, api.Forbidden("Only an admin can see invite codes"))
			return
		}
		var invites []models.InviteCode
		if err := db.Order("id DESC").Find(&invites).Error; err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		dtos, err := inviteDTOs(db, invites)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.OK(c, dtos)
	}
}

// cancelInviteHandler stops a code that has not been used. Admins only.
//
// DELETE /api/v1/invites/:inviteId
func cancelInviteHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !api.IsAdmin(c) {
			api.Fail(c, api.Forbidden("Only an admin can cancel invite codes"))
			return
		}
		id, err := api.IDParam(c, "inviteId")
		if err != nil {
			api.Fail(c, err)
			return
		}
		var inv models.InviteCode
		if dbErr := db.First(&inv, id).Error; dbErr != nil {
			api.Fail(c, api.FromDB(dbErr, "Invite code"))
			return
		}
		if inv.UsedAt != nil {
			api.Fail(c, api.Conflict("This code has already been used"))
			return
		}
		if inv.CancelledAt == nil {
			now := time.Now()
			if err := db.Model(&inv).Update("cancelled_at", now).Error; err != nil {
				api.Fail(c, api.Internal(err))
				return
			}
		}
		api.NoContent(c)
	}
}

// useInviteCode checks a code for signing up as email and marks it used by
// userID, inside the sign-up's transaction. Every way a code can be wrong is
// reported against the invite_code field, in words the person can act on.
func useInviteCode(tx *gorm.DB, raw, email string, userID int) error {
	bad := func(msg string) error {
		return api.Validation(msg).WithField("invite_code", msg)
	}
	if normalizeInviteCode(raw) == "" {
		return bad("Enter the invite code you were given")
	}
	var inv models.InviteCode
	err := tx.Where("code_hash = ?", hashInviteCode(raw)).Limit(1).Find(&inv).Error
	if err != nil {
		return api.Internal(err)
	}
	if inv.ID == 0 {
		return bad("That invite code is not right. Check it, or ask your admin for a new one")
	}
	switch inviteStatus(inv, time.Now()) {
	case "used":
		return bad("That invite code has already been used. Ask your admin for a new one")
	case "cancelled":
		return bad("That invite code was cancelled. Ask your admin for a new one")
	case "expired":
		return bad("That invite code has expired. Ask your admin for a new one")
	}
	if inv.Email != "" && !strings.EqualFold(inv.Email, email) {
		return bad("That invite code is for a different email address")
	}
	// Marked used only if nobody used it in the meantime.
	now := time.Now()
	res := tx.Model(&models.InviteCode{}).Where("id = ? AND used_at IS NULL", inv.ID).
		Updates(map[string]any{"used_at": now, "used_by_id": userID})
	if res.Error != nil {
		return api.Internal(res.Error)
	}
	if res.RowsAffected == 0 {
		return bad("That invite code has already been used. Ask your admin for a new one")
	}
	return nil
}

// inviteRequired says whether signing up needs a code: always, once the
// server has its first account.
func inviteRequired(db *gorm.DB) (bool, error) {
	var total int64
	if err := db.Model(&models.User{}).Count(&total).Error; err != nil {
		return false, err
	}
	return total > 0, nil
}

// signupInfoHandler tells the sign-up page whether to ask for a code.
//
// GET /api/v1/auth/signup
func signupInfoHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		required, err := inviteRequired(db)
		if err != nil {
			api.Fail(c, api.Internal(err))
			return
		}
		api.OK(c, gin.H{"invite_required": required})
	}
}

func inviteDTOs(db *gorm.DB, invites []models.InviteCode) ([]InviteDTO, error) {
	ids := []int{}
	for _, inv := range invites {
		ids = append(ids, inv.CreatedByID)
		if inv.UsedByID != nil {
			ids = append(ids, *inv.UsedByID)
		}
	}
	names := map[int]string{}
	if len(ids) > 0 {
		var users []models.User
		if err := db.Select("id", "name", "email").Where("id IN ?", ids).Find(&users).Error; err != nil {
			return nil, err
		}
		for _, u := range users {
			names[u.ID] = u.Name
			if names[u.ID] == "" {
				names[u.ID] = u.Email
			}
		}
	}
	now := time.Now()
	out := make([]InviteDTO, 0, len(invites))
	for _, inv := range invites {
		dto := InviteDTO{
			ID: inv.ID, Hint: inv.Hint, Email: inv.Email, Note: inv.Note, Status: inviteStatus(inv, now),
			CreatedBy: names[inv.CreatedByID], CreatedAt: inv.CreatedAt, ExpiresAt: inv.ExpiresAt, UsedAt: inv.UsedAt,
		}
		if inv.UsedByID != nil {
			dto.UsedBy = names[*inv.UsedByID]
		}
		out = append(out, dto)
	}
	return out, nil
}
