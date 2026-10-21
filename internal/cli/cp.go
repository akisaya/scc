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

	"scc/internal/s3x"
)

func cpCmd(args []string) error {
	fs := flag.NewFlagSet("cp", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	recursive := fs.Bool("r", false, "copy recursively")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 2 {
		return errors.New("usage: scc cp [-r] <src> <dst>")
	}
	src, dst := fs.Arg(0), fs.Arg(1)
	switch {
	case isS3(src) && isS3(dst):
		return cpS3ToS3(src, dst, *recursive)
	case isS3(src):
		return cpS3ToLocal(src, dst, *recursive)
	case isS3(dst):
		return cpLocalToS3(src, dst, *recursive)
	default:
		return errors.New("one side must be <account>:/bucket/key")
	}
}

func cpS3ToLocal(src, dst string, recursive bool) error {
	c, t, err := withTarget(src)
	if err != nil {
		return err
	}
	if t.key == "" {
		return errors.New("source needs a key or a prefix")
	}
	ctx := ctx()

	if !recursive {
		target := dst
		if filepath.IsAbs(dst) || strings.HasSuffix(dst, string(os.PathSeparator)) {
			if fi, err := os.Stat(dst); (err == nil && fi.IsDir()) || strings.HasSuffix(dst, string(os.PathSeparator)) {
				target = filepath.Join(dst, path.Base(t.key))
			}
		}
		return download(ctx, c, t.bucket, t.key, target)
	}

	l, err := c.List(ctx, t.bucket, t.key, true, 0)
	if err != nil {
		return err
	}
	for _, o := range l.Objects {
		rel := strings.TrimPrefix(o.Key, t.key)
		if err := download(ctx, c, t.bucket, o.Key, filepath.Join(dst, filepath.FromSlash(rel))); err != nil {
			return err
		}
	}
	return nil
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

func cpS3ToS3(src, dst string, recursive bool) error {
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

	if !recursive {
		key := dt.key
		if key == "" || strings.HasSuffix(key, "/") {
			key = joinKey(key, path.Base(st.key))
		}
		if err := dc.Copy(ctx, dt.bucket, key, s3x.Ref{Account: st.acct, Bucket: st.bucket, Key: st.key}); err != nil {
			return err
		}
		fmt.Printf("%s:/%s/%s -> %s\n", st.acct, st.bucket, key, dt.acct)
		return nil
	}

	l, err := sc.List(ctx, st.bucket, st.key, true, 0)
	if err != nil {
		return err
	}
	for _, o := range l.Objects {
		rel := strings.TrimPrefix(o.Key, st.key)
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
