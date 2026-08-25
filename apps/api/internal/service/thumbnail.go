package service

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"strings"

	xdraw "golang.org/x/image/draw"

	"github.com/Devlaner/devlane/api/internal/minio"
	_ "golang.org/x/image/webp" // register WebP decoder
)

// thumbMaxDim is the max width/height of a generated thumbnail. The thumbnail
// preserves aspect ratio; the longest side is capped at this value.
const thumbMaxDim = 400

// thumbJPEGQuality is the JPEG quality for thumbnail encoding (0-100). Lower
// means smaller files; 75 keeps a good visual quality for a 400px image.
const thumbJPEGQuality = 75

// thumbSuffix is appended to the original object name for the thumbnail object.
// e.g. attachments/<issue>/<asset>      (original)
//
//	attachments/<issue>/<asset>-thumb (thumbnail, JPEG)
const thumbSuffix = "-thumb"

// generateThumbnail reads the original image object from MinIO, decodes it
// (JPEG/PNG/GIF/WebP), resizes it (preserving aspect ratio, longest side =
// thumbMaxDim) and stores the result as JPEG under objectName+thumbSuffix.
//
// Returns nil (no error) silently when:
//   - the object is not a decodable image (non-image attachments),
//   - decoding fails (e.g. SVG, broken file).
//
// In those cases the caller simply has no thumbnail and the UI falls back to
// the original URL. Any real I/O / encode error is returned.
func GenerateThumbnail(ctx context.Context, mc *minio.Client, objectName string) error {
	if mc == nil {
		return nil
	}
	contentType, err := mc.ContentType(ctx, objectName)
	if err != nil {
		return nil // object missing or stat failed — nothing to do
	}
	if !strings.HasPrefix(contentType, "image/") {
		return nil // not an image — skip
	}

	obj, err := mc.GetObject(ctx, objectName)
	if err != nil {
		return fmt.Errorf("thumb get original: %w", err)
	}
	defer obj.Close()

	src, _, err := image.Decode(obj)
	if err != nil {
		// image.Decode returns an error for SVG, HEIC, or any unsupported format.
		// We treat this as "no thumbnail" rather than a hard failure.
		return nil
	}

	thumb := scaleDown(src, thumbMaxDim)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: thumbJPEGQuality}); err != nil {
		return fmt.Errorf("thumb encode: %w", err)
	}

	thumbName := objectName + thumbSuffix
	return mc.PutObject(ctx, thumbName, &buf, int64(buf.Len()), "image/jpeg")
}

// scaleDown returns a new RGBA image whose longest side is maxDim, preserving
// aspect ratio. If src is already smaller than maxDim on both sides, it is
// returned as-is (drawn onto a new RGBA canvas so the encoder always sees RGBA).
// Uses a fast nearest-neighbor scale — sufficient for 400px previews.
func scaleDown(src image.Image, maxDim int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return src
	}
	if w > maxDim || h > maxDim {
		if w >= h {
			h = h * maxDim / w
			w = maxDim
		} else {
			w = w * maxDim / h
			h = maxDim
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	// CatmullRom is the highest-quality scaler in x/image/draw. For a 400px
	// thumbnail the cost is negligible vs nearest-neighbor, and the visual
	// difference on photos is significant.
	xdraw.CatmullRom.Scale(dst, dst.Rect, src, b, xdraw.Over, nil)
	return dst
}

// hasThumbnail reports whether a thumbnail object exists in MinIO for the given
// object name. Used to decide whether to advertise a thumbnail URL.
// Errors (including missing object) are treated as "no thumbnail".
func hasThumbnail(ctx context.Context, mc *minio.Client, objectName string) bool {
	if mc == nil {
		return false
	}
	return mc.Exists(ctx, objectName+thumbSuffix)
}

// thumbnailURLFor builds the browser-facing URL for an object's thumbnail,
// using the same base as the original. Returns "" if no thumbnail exists.
func thumbnailURLFor(ctx context.Context, mc *minio.Client, assetURL, objectName string) string {
	if mc == nil || assetURL == "" {
		return ""
	}
	if !hasThumbnail(ctx, mc, objectName) {
		return ""
	}
	// assetURL is like "/api/files/attachments/<issue>/<asset>"; the thumbnail
	// object is "<objectName>-thumb" and served via the same /api/files/ path.
	return assetURL + thumbSuffix
}
