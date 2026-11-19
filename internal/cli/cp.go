package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/akisaya/scc/internal/s3x"
)

func cpCmd(args []string) error {
	fs := flag.NewFlagSet("cp", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "copy recursively")
	prefixMode := fs.Bool("p", false, "treat the S3 source as a raw prefix")
	if err := fs.Parse(flagsFirst(args)); err != nil {
		return err
	}
	if fs.NArg() != 2 {
		return errors.New("usage: scc cp [-p] [-r] <src> <dst>")
	}
	src, dst := fs.Arg(0), fs.Arg(1)
	if *prefixMode && !isS3(src) {
		return errors.New("cp -p requires an S3 source")
	}
	switch {
	case isS3(src) && isS3(dst):
		return cpS3ToS3(src, dst, *recursive, *prefixMode)
	case isS3(src):
		return cpS3ToLocal(src, dst, *recursive, *prefixMode)
	case isS3(dst):
		return cpLocalToS3(src, dst, *recursive)
	default:
		return errors.New("one side must be <account>://bucket/key")
	}
}

func cpS3ToLocal(src, dst string, recursive, prefixMode bool) error {
	c, t, err := withTarget(src)
	if err != nil {
		return err
	}
	if t.key == "" {
		return errors.New("source needs a key or a prefix")
	}
	ctx := ctx()
	// HEAD shares the permission used by GET, so copying a file needs no listing access.
	selected, err := resolveSource(t.key, prefixMode, func() (s3x.Object, error) {
		return copyObject(ctx, c, t.bucket, t.key)
	})
	if err != nil {
		return err
	}

	if selected.object != nil {
		target := dst
		if fi, err := os.Stat(dst); (err == nil && fi.IsDir()) || strings.HasSuffix(dst, string(os.PathSeparator)) {
			target = filepath.Join(dst, path.Base(t.key))
		}
		return download(ctx, c, t.bucket, t.key, target)
	}
	if !prefixMode && !recursive {
		return fmt.Errorf("source %q is not a file; pass -r to copy directory contents", src)
	}

	l, err := c.List(ctx, t.bucket, selected.prefix, recursive, 0)
	if err != nil {
		return err
	}
	base := selected.prefix
	if prefixMode {
		base = parentPrefix(base)
	}
	targets, err := downloadTargets(l.Objects, base, dst)
	if err != nil {
		return err
	}
	for _, o := range l.Objects {
		if strings.HasSuffix(o.Key, "/") {
			continue
		}
		if err := download(ctx, c, t.bucket, o.Key, targets[o.Key]); err != nil {
			return err
		}
	}
	return nil
}

// Check the complete mapping before downloading: S3 keys can collide when
// represented as local paths, especially a file and a same-named directory.
func downloadTargets(objects []s3x.Object, base, dst string) (map[string]string, error) {
	targets := make(map[string]string)
	keys := make(map[string]string)
	for _, o := range objects {
		if strings.HasSuffix(o.Key, "/") {
			continue
		}
		rel := filepath.FromSlash(strings.TrimPrefix(o.Key, base))
		if !filepath.IsLocal(rel) || filepath.Clean(rel) == "." {
			return nil, fmt.Errorf("object %q cannot be mapped inside destination %q", o.Key, dst)
		}
		target := filepath.Join(dst, rel)
		if other, ok := keys[target]; ok {
			return nil, fmt.Errorf("objects %q and %q map to the same local path", other, o.Key)
		}
		targets[o.Key], keys[target] = target, o.Key
	}
	for _, o := range objects {
		target, ok := targets[o.Key]
		if !ok {
			continue
		}
		for dir := filepath.Dir(target); ; dir = filepath.Dir(dir) {
			if other, ok := keys[dir]; ok {
				return nil, fmt.Errorf("local file/directory conflict between objects %q and %q", other, o.Key)
			}
			if dir == filepath.Dir(dir) {
				break
			}
		}
	}
	return targets, nil
}

func download(ctx context.Context, c *s3x.Client, bucket, key, dst string) error {
	out, err := c.Get(ctx, bucket, key)
	if err != nil {
		return err
	}
	defer out.Body.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, out.Body); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	fmt.Printf("%s -> %s\n", key, dst)
	return nil
}

func cpLocalToS3(src, dst string, recursive bool) error {
	c, t, err := withTarget(dst)
	if err != nil {
		return err
	}
	if t.bucket == "" {
		return errors.New("destination needs a bucket")
	}
	ctx := ctx()

	fi, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !fi.IsDir() {
		key := t.key
		if key == "" || strings.HasSuffix(key, "/") {
			key = joinKey(key, filepath.Base(src))
		}
		return upload(ctx, c, t.bucket, key, src, fi.Size())
	}
	if !recursive {
		return fmt.Errorf("%s is a directory, pass -r", src)
	}
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}
		key := joinKey(t.key, filepath.ToSlash(rel))
		info, err := d.Info()
		if err != nil {
			return err
		}
		return upload(ctx, c, t.bucket, key, p, info.Size())
	})
}

func upload(ctx context.Context, c *s3x.Client, bucket, key, src string, size int64) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	ct := mime.TypeByExtension(filepath.Ext(src))
	if err := c.Put(ctx, bucket, key, f, size, ct); err != nil {
		return err
	}
	fmt.Printf("%s -> %s\n", src, key)
	return nil
}

func cpS3ToS3(src, dst string, recursive, prefixMode bool) error {
	sc, st, err := withTarget(src)
	if err != nil {
		return err
	}
	dc, dt, err := withTarget(dst)
	if err != nil {
		return err
	}
	if st.key == "" || dt.bucket == "" {
		return errors.New("source and destination both need a key")
	}
	if st.acct != dt.acct {
		return errors.New("cross-account copy is not supported; download and upload instead")
	}
	ctx := ctx()
	selected, err := resolveSource(st.key, prefixMode, func() (s3x.Object, error) {
		return copyObject(ctx, sc, st.bucket, st.key)
	})
	if err != nil {
		return err
	}

	if selected.object != nil {
		key := dt.key
		if key == "" || strings.HasSuffix(key, "/") {
			key = joinKey(key, path.Base(st.key))
		}
		if err := dc.Copy(ctx, dt.bucket, key, s3x.Ref{Account: st.acct, Bucket: st.bucket, Key: st.key}); err != nil {
			return err
		}
		fmt.Printf("%s://%s/%s -> %s\n", st.acct, st.bucket, key, dt.acct)
		return nil
	}
	if !prefixMode && !recursive {
		return fmt.Errorf("source %q is not a file; pass -r to copy directory contents", src)
	}

	l, err := sc.List(ctx, st.bucket, selected.prefix, recursive, 0)
	if err != nil {
		return err
	}
	base := selected.prefix
	if prefixMode {
		base = parentPrefix(base)
	}
	for _, o := range l.Objects {
		if strings.HasSuffix(o.Key, "/") {
			continue
		}
		rel := strings.TrimPrefix(o.Key, base)
		key := joinKey(dt.key, rel)
		if err := dc.Copy(ctx, dt.bucket, key, s3x.Ref{Account: st.acct, Bucket: st.bucket, Key: o.Key}); err != nil {
			return err
		}
		fmt.Printf("%s -> %s\n", o.Key, key)
	}
	return nil
}

func joinKey(a, b string) string {
	a = strings.TrimSuffix(a, "/")
	b = strings.TrimPrefix(b, "/")
	if a == "" {
		return b
	}
	return a + "/" + b
}
