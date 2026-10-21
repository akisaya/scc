package s3x

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type Object struct {
	Key          string
	Size         int64
	LastModified time.Time
	ETag         string
}

// Listing holds one directory level unless Recursive was requested.
type Listing struct {
	Prefixes  []string
	Objects   []Object
	Truncated bool   // more keys exist than were returned
	Cursor    string // continuation token for the next page, empty on the last one
}

func (c *Client) Buckets(ctx context.Context) ([]string, error) {
	out, err := c.ListBuckets(ctx, &s3.ListBucketsInput{})
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(out.Buckets))
	for _, b := range out.Buckets {
		names = append(names, aws.ToString(b.Name))
	}
	return names, nil
}

// List returns one level (or everything when recursive). maxKeys > 0 caps the
// result to a single page, which the UI uses so a huge folder cannot hang the page.
func (c *Client) List(ctx context.Context, bucket, prefix string, recursive bool, maxKeys int32) (*Listing, error) {
	in := &s3.ListObjectsV2Input{Bucket: aws.String(bucket), Prefix: aws.String(prefix)}
	if !recursive {
		in.Delimiter = aws.String("/")
	}
	res := &Listing{}
	if maxKeys > 0 {
		return c.ListPage(ctx, bucket, prefix, recursive, maxKeys, "")
	}
	p := s3.NewListObjectsV2Paginator(c.Client, in)
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		res.add(page, prefix)
	}
	sort.Strings(res.Prefixes)
	return res, nil
}

// ListPage returns a single page plus the token needed to fetch the next one.
// An empty cursor starts at the beginning; an empty result cursor means the end.
func (c *Client) ListPage(ctx context.Context, bucket, prefix string, recursive bool, maxKeys int32, cursor string) (*Listing, error) {
	in := &s3.ListObjectsV2Input{Bucket: aws.String(bucket), Prefix: aws.String(prefix)}
	if !recursive {
		in.Delimiter = aws.String("/")
	}
	if maxKeys > 0 {
		in.MaxKeys = aws.Int32(maxKeys)
	}
	if cursor != "" {
		in.ContinuationToken = aws.String(cursor)
	}
	page, err := c.ListObjectsV2(ctx, in)
	if err != nil {
		return nil, err
	}
	res := &Listing{}
	res.add(page, prefix)
	res.Truncated = aws.ToBool(page.IsTruncated)
	if res.Truncated {
		res.Cursor = aws.ToString(page.NextContinuationToken)
	}
	return res, nil
}

func (l *Listing) add(page *s3.ListObjectsV2Output, prefix string) {
	for _, o := range page.Contents {
		if aws.ToString(o.Key) == prefix {
			continue // zero-byte placeholder for the folder itself
		}
		l.Objects = append(l.Objects, Object{
			Key:          aws.ToString(o.Key),
			Size:         aws.ToInt64(o.Size),
			LastModified: aws.ToTime(o.LastModified),
			ETag:         aws.ToString(o.ETag),
		})
	}
	for _, cp := range page.CommonPrefixes {
		l.Prefixes = append(l.Prefixes, aws.ToString(cp.Prefix))
	}
}

func (c *Client) Get(ctx context.Context, bucket, key string) (*s3.GetObjectOutput, error) {
	return c.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
}

func (c *Client) GetRange(ctx context.Context, bucket, key, rng string) (*s3.GetObjectOutput, error) {
	in := &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)}
	if rng != "" {
		in.Range = aws.String(rng)
	}
	return c.GetObject(ctx, in)
}

func (c *Client) Put(ctx context.Context, bucket, key string, body io.Reader, size int64, contentType string) error {
	// shortcut: the SDK must rewind the body to hash it, so non-seekable input
	// (an HTTP request body) is spilled to a temp file. Upgrade to presigned
	// streaming or multipart upload if very large web uploads matter.
	if _, ok := body.(io.ReadSeeker); !ok {
		f, err := os.CreateTemp("", "scc-upload-*")
		if err != nil {
			return err
		}
		defer func() { f.Close(); os.Remove(f.Name()) }()
		n, err := io.Copy(f, body)
		if err != nil {
			return err
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return err
		}
		body, size = f, n
	}
	in := &s3.PutObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
		Body:   body,
	}
	if size >= 0 {
		in.ContentLength = aws.Int64(size)
	}
	if contentType != "" {
		in.ContentType = aws.String(contentType)
	}
	_, err := c.PutObject(ctx, in)
	return err
}

func (c *Client) Delete(ctx context.Context, bucket, key string) error {
	_, err := c.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	return err
}

// DeletePrefix removes every object under prefix, batching as the API requires.
func (c *Client) DeletePrefix(ctx context.Context, bucket, prefix string) (int, error) {
	if prefix == "" {
		return 0, errors.New("refusing to delete a whole bucket at once; name a prefix, e.g. scc rm -r acct:/bucket/dir/")
	}
	listed, err := c.List(ctx, bucket, prefix, true, 0)
	if err != nil {
		return 0, err
	}
	n := 0
	for start := 0; start < len(listed.Objects); start += 1000 {
		end := min(start+1000, len(listed.Objects))
		batch := make([]types.ObjectIdentifier, 0, end-start)
		for _, o := range listed.Objects[start:end] {
			batch = append(batch, types.ObjectIdentifier{Key: aws.String(o.Key)})
		}
		if _, err := c.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(bucket),
			Delete: &types.Delete{Objects: batch, Quiet: aws.Bool(true)},
		}); err != nil {
			return n, err
		}
		n += len(batch)
	}
	// List hides the "dir/" placeholder object, so remove it separately.
	if err := c.Delete(ctx, bucket, prefix); err != nil {
		return n, err
	}
	return n, nil
}

func (c *Client) Copy(ctx context.Context, bucket, key string, src Ref) error {
	_, err := c.CopyObject(ctx, &s3.CopyObjectInput{
		Bucket:     aws.String(bucket),
		Key:        aws.String(key),
		CopySource: aws.String(escapeCopySource(src.Bucket, src.Key)),
	})
	return err
}

func (c *Client) MkBucket(ctx context.Context, bucket string) error {
	_, err := c.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)})
	return err
}

func (c *Client) RemoveBucket(ctx context.Context, bucket string) error {
	_, err := c.DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: aws.String(bucket)})
	return err
}

func escapeCopySource(bucket, key string) string {
	segs := strings.Split(key, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	return fmt.Sprintf("%s/%s", bucket, strings.Join(segs, "/"))
}
