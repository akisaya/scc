package web

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	smithyhttp "github.com/aws/smithy-go/transport/http"

	"scc/internal/config"
	"scc/internal/s3x"
)

//go:embed static
var static embed.FS

func Serve(cfg *config.Config) error {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/accounts", handleAccounts)
	mux.HandleFunc("POST /api/accounts", handleAddAccount)
	mux.HandleFunc("GET /api/b/{acct}/buckets", handleBuckets)
	mux.HandleFunc("POST /api/b/{acct}/buckets", handleMkBucket)
	mux.HandleFunc("DELETE /api/b/{acct}/buckets/{bucket}", handleRmBucket)
	mux.HandleFunc("GET /api/b/{acct}/objects/{bucket}", handleList)
	mux.HandleFunc("GET /api/b/{acct}/raw/{bucket}/{key...}", handleGet)
	mux.HandleFunc("PUT /api/b/{acct}/raw/{bucket}/{key...}", handlePut)
	mux.HandleFunc("DELETE /api/b/{acct}/raw/{bucket}/{key...}", handleDelete)
	mux.HandleFunc("POST /api/b/{acct}/copy", handleCopy)

	sub, err := fs.Sub(static, "static")
	if err != nil {
		return err
	}
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServerFS(sub)))
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		b, err := static.ReadFile("static/index.html")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(b)
	})

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           logRequests(auth(cfg.Token, noStore(mux))),
		ReadHeaderTimeout: 10 * time.Second,
	}
	fmt.Printf("scc web on http://%s\n", cfg.Listen)
	if cfg.Token == "" && !isLocal(cfg.Listen) {
		fmt.Fprintln(os.Stderr, "warning: no token set and the listener is not local-only.")
		fmt.Fprintln(os.Stderr, "         anyone who can reach this port can use your S3 credentials.")
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return err
	case <-sig:
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return srv.Shutdown(ctx)
	}
}

// logRequests prints one line per API call, so a browser-side failure can be
// checked against what actually reached the server.
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.RequestURI(), rec.status,
			time.Since(start).Round(time.Millisecond))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// noStore keeps browsers from serving stale embedded assets after an upgrade.
func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func isLocal(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	if host == "" || host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// auth accepts the token as a bearer header, a ?token= query param, or the cookie
// that the query param sets so the browser only sees the token once.
func auth(token string, next http.Handler) http.Handler {
	if token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("token") == token {
			http.SetCookie(w, &http.Cookie{Name: "scc_token", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		if c, err := r.Cookie("scc_token"); err == nil && c.Value == token {
			next.ServeHTTP(w, r)
			return
		}
		if strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ") == token {
			next.ServeHTTP(w, r)
			return
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	})
}

// client resolves an account on every request, so accounts added by the CLI show up live.
func client(name string) (*s3x.Client, *config.Account, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	a, err := cfg.Account(name)
	if err != nil {
		return nil, nil, err
	}
	c, err := s3x.Open(*a)
	return c, a, err
}

func handleAccounts(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.Load()
	if err != nil {
		writeErr(w, err)
		return
	}
	type row struct {
		Name          string `json:"name"`
		Endpoint      string `json:"endpoint"`
		DefaultBucket string `json:"default_bucket"`
	}
	out := make([]row, 0, len(cfg.Accounts))
	for _, a := range cfg.Accounts {
		out = append(out, row{Name: a.Name, Endpoint: a.Endpoint, DefaultBucket: a.DefaultBucket})
	}
	writeJSON(w, out)
}

// handleAddAccount writes a new account to the config file. Credentials never
// come back out through the API.
func handleAddAccount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name          string `json:"name"`
		Endpoint      string `json:"endpoint"`
		Region        string `json:"region"`
		AccessKey     string `json:"access_key"`
		SecretKey     string `json:"secret_key"`
		PathStyle     *bool  `json:"path_style"`
		DefaultBucket string `json:"default_bucket"`
		Replace       bool   `json:"replace"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := config.ValidName(body.Name); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.AccessKey == "" || body.SecretKey == "" {
		http.Error(w, "access_key and secret_key are required", http.StatusBadRequest)
		return
	}
	cfg, err := config.Load()
	if err != nil {
		writeErr(w, err)
		return
	}
	if cfg.Exists(body.Name) && !body.Replace {
		http.Error(w, fmt.Sprintf("account %q already exists", body.Name), http.StatusConflict)
		return
	}

	region := body.Region
	if region == "" {
		region = "us-east-1"
	}
	endpoint := strings.TrimRight(strings.TrimSpace(body.Endpoint), "/")
	pathStyle := endpoint != ""
	if body.PathStyle != nil {
		pathStyle = *body.PathStyle
	}
	cfg.Upsert(config.Account{
		Name:          body.Name,
		Endpoint:      endpoint,
		Region:        region,
		AccessKey:     body.AccessKey,
		SecretKey:     body.SecretKey,
		PathStyle:     pathStyle,
		DefaultBucket: strings.TrimSpace(body.DefaultBucket),
	})
	if err := cfg.Save(); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func handleBuckets(w http.ResponseWriter, r *http.Request) {
	c, _, err := client(r.PathValue("acct"))
	if err != nil {
		writeErr(w, err)
		return
	}
	names, err := c.Buckets(r.Context())
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, names)
}

func handleMkBucket(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Name == "" {
		http.Error(w, `expected {"name": "..."}`, http.StatusBadRequest)
		return
	}
	c, _, err := client(r.PathValue("acct"))
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := c.MkBucket(r.Context(), body.Name); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleRmBucket(w http.ResponseWriter, r *http.Request) {
	c, _, err := client(r.PathValue("acct"))
	if err != nil {
		writeErr(w, err)
		return
	}
	if err := c.RemoveBucket(r.Context(), r.PathValue("bucket")); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleList(w http.ResponseWriter, r *http.Request) {
	c, _, err := client(r.PathValue("acct"))
	if err != nil {
		writeErr(w, err)
		return
	}
	bucket := r.PathValue("bucket")
	q := r.URL.Query()
	prefix := q.Get("prefix")
	recursive := q.Get("recursive") == "1"

	// One page at a time: the UI asks for the next page by handing back next_cursor.
	limit := int32(200)
	if v, err := strconv.Atoi(q.Get("limit")); err == nil && v > 0 && v <= 1000 {
		limit = int32(v)
	}
	l, err := c.ListPage(r.Context(), bucket, prefix, recursive, limit, q.Get("cursor"))
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, map[string]any{
		"prefix":      prefix,
		"prefixes":    l.Prefixes,
		"objects":     l.Objects,
		"truncated":   l.Truncated,
		"next_cursor": l.Cursor,
	})
}

func handleGet(w http.ResponseWriter, r *http.Request) {
	c, _, err := client(r.PathValue("acct"))
	if err != nil {
		writeErr(w, err)
		return
	}
	key := r.PathValue("key")
	if key == "" {
		http.Error(w, "missing key", 400)
		return
	}
	// Rebuild the Range header from the validated request value only.
	rng := r.Header.Get("Range")
	out, err := c.GetRange(r.Context(), r.PathValue("bucket"), key, rng)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer out.Body.Close()

	h := w.Header()
	ct := aws.ToString(out.ContentType)
	if ct == "" || ct == "application/octet-stream" || ct == "binary/octet-stream" {
		if guess := mime.TypeByExtension(path.Ext(key)); guess != "" {
			ct = guess
		}
	}
	if ct != "" {
		h.Set("Content-Type", ct)
	}
	if out.ContentLength != nil {
		h.Set("Content-Length", strconv.FormatInt(*out.ContentLength, 10))
	}
	if out.ContentRange != nil {
		h.Set("Content-Range", *out.ContentRange)
	}
	if out.AcceptRanges != nil {
		h.Set("Accept-Ranges", *out.AcceptRanges)
	} else {
		h.Set("Accept-Ranges", "bytes")
	}
	disp := "inline"
	if r.URL.Query().Get("download") == "1" {
		disp = "attachment"
	}
	h.Set("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disp, urlEscape(path.Base(key))))

	status := http.StatusOK
	if rng != "" && out.ContentRange != nil {
		status = http.StatusPartialContent
	}
	w.WriteHeader(status)
	io.Copy(w, out.Body)
}

func handlePut(w http.ResponseWriter, r *http.Request) {
	c, _, err := client(r.PathValue("acct"))
	if err != nil {
		writeErr(w, err)
		return
	}
	key := r.PathValue("key")
	if key == "" {
		http.Error(w, "missing key", 400)
		return
	}
	ct := r.Header.Get("Content-Type")
	if ct == "" || ct == "application/octet-stream" {
		ct = mime.TypeByExtension(path.Ext(key))
	}
	if err := c.Put(r.Context(), r.PathValue("bucket"), key, r.Body, r.ContentLength, ct); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	c, _, err := client(r.PathValue("acct"))
	if err != nil {
		writeErr(w, err)
		return
	}
	bucket, key := r.PathValue("bucket"), r.PathValue("key")
	if key == "" {
		http.Error(w, "missing key", 400)
		return
	}
	if strings.HasSuffix(key, "/") || r.URL.Query().Get("recursive") == "1" {
		if _, err := c.DeletePrefix(r.Context(), bucket, key); err != nil {
			writeErr(w, err)
			return
		}
	} else if err := c.Delete(r.Context(), bucket, key); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleCopy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FromBucket string `json:"from_bucket"`
		FromKey    string `json:"from_key"`
		ToBucket   string `json:"to_bucket"`
		ToKey      string `json:"to_key"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.FromKey == "" || body.ToKey == "" {
		http.Error(w, "expected {from_bucket, from_key, to_bucket, to_key}", http.StatusBadRequest)
		return
	}
	acct := r.PathValue("acct")
	c, _, err := client(acct)
	if err != nil {
		writeErr(w, err)
		return
	}
	if body.ToBucket == "" {
		body.ToBucket = body.FromBucket
	}
	src := s3x.Ref{Account: acct, Bucket: body.FromBucket, Key: body.FromKey}
	if err := c.Copy(r.Context(), body.ToBucket, body.ToKey, src); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// decodeJSON rejects anything that is not a JSON body, which also stops a
// cross-site form post from reaching a handler without a CORS preflight.
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		http.Error(w, "expected Content-Type: application/json", http.StatusUnsupportedMediaType)
		return false
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v); err != nil {
		http.Error(w, "invalid json: "+err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	code := http.StatusBadGateway
	var re *smithyhttp.ResponseError
	if errors.As(err, &re) {
		if sc := re.HTTPStatusCode(); sc >= 400 && sc < 500 {
			code = sc
		}
	} else if strings.Contains(err.Error(), "not found") {
		code = http.StatusNotFound
	}
	msg := err.Error()
	if h := s3x.Hint(err); h != "" {
		msg += "\n" + h
	}
	http.Error(w, msg, code)
}

// urlEscape keeps the Content-Disposition header RFC 5987-safe.
func urlEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune("-._~", rune(c)) {
			b.WriteByte(c)
		} else {
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}
