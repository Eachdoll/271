declare namespace Cloudflare {
  interface Env {
    BUCKET: R2Bucket;
    /** Family signup invite code (server secret, at least 12 characters). */
    FAMILY_SIGNUP_CODE?: string;
  }
}
