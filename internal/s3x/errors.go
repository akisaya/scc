package s3x

import (
	"errors"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// IsNotFound reports whether err means "this key or bucket does not exist".
// Gateways disagree on which error type they return, so the shape of the
// message is checked as well; a 404 can never mean a successful operation.
func IsNotFound(err error) bool {
	if err == nil {
		return false
	}
	var notFound *types.NotFound
	var noSuchKey *types.NoSuchKey
	if errors.As(err, &notFound) || errors.As(err, &noSuchKey) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "StatusCode: 404") ||
		strings.Contains(msg, "NoSuchKey") ||
		strings.Contains(msg, "NotFound")
}

// Hint turns the SDK's error text into one actionable sentence. Errors from S3
// compatible gateways bury the cause in a long "operation error S3: ..." line.
func Hint(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "SignatureDoesNotMatch"):
		return "the access key exists but the secret key is wrong or truncated; re-check secret_key"
	case strings.Contains(msg, "InvalidAccessKeyId"):
		return "this access key does not exist on the endpoint; check -access-key and the endpoint URL"
	case strings.Contains(msg, "RequestTimeTooSkewed"):
		return "the local clock differs from the server; sync the system time"
	case strings.Contains(msg, "AccessDenied"):
		return "the credentials are valid but not allowed to do this; check the account's permissions"
	case strings.Contains(msg, "BucketNotEmpty"):
		return "the bucket is not empty; delete the objects you mean to, e.g. scc rm -r acct://bucket/<prefix>"
	case strings.Contains(msg, "NoSuchBucket"):
		return "no such bucket on this account; run: scc buckets <account>"
	case strings.Contains(msg, "x509:"), strings.Contains(msg, "certificate"):
		return "the endpoint's TLS certificate is not trusted; fix the certificate or the CA bundle"
	case strings.Contains(msg, "connection refused"), strings.Contains(msg, "no such host"),
		strings.Contains(msg, "timeout"), strings.Contains(msg, "dial tcp"):
		return "cannot reach the endpoint; check -endpoint and your network"
	}
	return ""
}
