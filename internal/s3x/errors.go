package s3x

import "strings"

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
		return "the bucket is not empty; delete its objects first (scc rm -r acct:/bucket/)"
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
