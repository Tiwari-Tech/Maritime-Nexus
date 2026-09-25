/**
 * Translates Firebase Authentication error codes into professional, user-friendly messages.
 */
export function getAuthErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "An unexpected authentication error occurred. Please try again.";
  }

  const err = error as { code?: string; message?: string };
  const code = err.code || "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password. Please verify your credentials.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Please sign in instead.";
    case "auth/weak-password":
      return "Password must be at least 6 characters long.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled before completion.";
    case "auth/popup-blocked":
      return "The Google sign-in popup was blocked by your browser. Please allow popups and try again.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Access temporarily disabled. Please try again later.";
    case "auth/user-disabled":
      return "This account has been suspended. Please contact your system administrator.";
    case "auth/network-request-failed":
      return "Unable to connect to authentication service. Please check your internet connection.";
    default:
      return err.message || "Authentication failed. Please try again.";
  }
}
