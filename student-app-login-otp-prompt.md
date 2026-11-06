# Student app (dr_app): require an emailed OTP on every email + password login

## Goal
Logging in with email and password becomes two steps:
1. The student enters email and password and taps **Login**.
2. The server checks the password and **emails a 6-digit code**. It returns **no tokens** at this step.
3. The app opens the OTP screen. The student enters the code, and only then the server returns the session (access and refresh tokens).

Google sign-in does not change. Sign-up verification (`/auth/verify-otp`) and Forgot Password (`/auth/forgot-password`, `/auth/reset-password`) do not change.

## Backend contract (being added to the backend; base URL `$baseUrl` = `https://doctorapp-backend-cl2h.onrender.com/api`)

### Step 1: `POST $baseUrl/auth/login`
Body: `{ "email": "...", "password": "...", "deviceId": "..." }` (same body as today)

| Status | Body | Meaning |
|---|---|---|
| **200** | `{ "otpRequired": true, "message": "We emailed you a 6-digit code.", "otpExpiresInSeconds": 600, "resendAfterSeconds": 60 }` | Password correct, code sent. **No tokens.** Open the OTP screen |
| 401 | `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password" } }` | Wrong email or password |
| 403 | `error.code = "EMAIL_NOT_VERIFIED"` | Signup never verified. Existing handling already sends the student to the signup OTP screen. Keep it |
| 403 | `error.code = "ACCOUNT_DEACTIVATED"` | Show the existing refusal sheet |

**Resend:** calling `POST /auth/login` again with the same email and password sends a new code (at most once per 60 seconds; a call inside the minute still returns 200 but sends nothing). There is no separate resend endpoint for login.

### Step 2: `POST $baseUrl/auth/login/verify-otp`
Body: `{ "email": "...", "code": "123456", "deviceId": "..." }`

| Status | Body | Meaning |
|---|---|---|
| **200** | Exactly the same session reply as `/auth/google` and `/auth/verify-otp` today (`accessToken`, `refreshToken`, `isNewUser`, `sessionId`, `notice`, `previousSession`, `signedOutOtherDevice`, `user`) | Signed in |
| 400 | `error.code = "INVALID_OTP"`, plus top-level `attemptsLeft` (int) | Wrong code |
| 400 | `error.code = "OTP_EXPIRED"` | Code expired or none pending. Offer resend |
| 429 | `error.code = "OTP_LOCKED"` | 5 wrong codes. Offer resend |
| 409 | `error.code = "SESSION_ACTIVE_ELSEWHERE"`, top-level `retryAfterMinutes` | Same as Google today. Show the existing refusal sheet |
| 403 | `error.code = "ACCOUNT_DEACTIVATED"` | Show the existing refusal sheet |

## What exists in the app today (reuse it)
- `lib/core/constant/api_constant.dart`: `login`, `verifyOtp`, `resendOtp` constants.
- `lib/services/Auth_services.dart`:
  - `_signInToBackend(url, payload)` adds `deviceId`, posts, on 200 parses `AuthResultModel` and saves both tokens, otherwise throws `LoginRefusedException` via `_refusalFrom` (which already appends "N tries left." from `attemptsLeft`).
  - `loginWithEmail(email, password)` currently calls `_signInToBackend(ApiConstant.login, ...)` and expects tokens. **This must change.**
  - `LoginRefusedException` has `code`, `message`, `retryAfterMinutes`, `isEmailNotVerified`, `isAccountBlocked` (also true for `ACCOUNT_DEACTIVATED`), `isSessionActiveElsewhere`.
- `lib/repository/google_sign_in_provider.dart` (`GoogleSignInIntergration`): `_signIn(fn)` sets `isLoading`, `refusal`, `errorMessage`, `authResult`. Has `loginWithEmail`, `verifyOtp`, `resendOtp`.
- `lib/view/Authendication/login/Sign_in_screen.dart`: `_loginWithEmail(viewModel)` calls `_signIn(viewModel, () => viewModel.loginWithEmail(email, password))`. `_signIn` handles `isEmailNotVerified` (resend + push `OtpScreen`), other refusals (`showLoginRefusedDialog`), and success (`AuthProvider.adoptSession` then `popUntil(first)`).
- `lib/view/Authendication/login/otp_screen.dart` (`OtpScreen(email)`): 6-digit field (auto-submits at 6 digits), Verify button, 60-second resend timer, inline red error, `AppLoadingScreen` while verifying; on success calls `AuthProvider.adoptSession(result)` then `Navigator.popUntil(first)`. It currently calls `viewModel.verifyOtp` and `viewModel.resendOtp` (signup verification).

## Changes to make

1. **`api_constant.dart`:** add `static const String loginVerifyOtp = '$baseUrl/auth/login/verify-otp';`

2. **`Auth_services.dart`:**
   - Change `loginWithEmail(email, password)` to return `Future<void>`: post `{email, password, deviceId}` to `ApiConstant.login` (get `deviceId` from `DeviceIdHelper.getDeviceId()`, like `_signInToBackend`). If the status is 200 **and** the body has `otpRequired == true`, return normally (no tokens to save). Any other status: `throw _refusalFrom(response, "Could not sign in. Please try again.")`. Log only the status in debug mode, never the body.
   - Add `Future<AuthResultModel> verifyLoginOtp(String email, String code) => _signInToBackend(ApiConstant.loginVerifyOtp, {"email": email, "code": code});`

3. **`google_sign_in_provider.dart`:**
   - Replace `loginWithEmail` with a method that **does not** go through `_signIn` (there is no session yet). Use the same pattern as `registerWithEmail`: return `Future<LoginRefusedException?>` (null when the code was sent); catch non-`LoginRefusedException` errors and return `LoginRefusedException(code: null, message: 'Could not reach the server. Check your connection and try again.')`. Set and clear `isLoading` around it and call `notifyListeners()`.
   - Add `Future<bool> verifyLoginOtp(String email, String code) => _signIn(() => _authService.verifyLoginOtp(email, code));`

4. **`otp_screen.dart`:** make it serve both flows with one new constructor parameter, `final bool isLogin;` (default `false`).
   - Verify: `isLogin ? viewModel.verifyLoginOtp(email, code) : viewModel.verifyOtp(email, code)`.
   - Resend: for login, the screen needs the password to call `/auth/login` again, so add `final String? password;` and pass it from the login screen; resend calls `viewModel.loginWithEmail(email, password!)` and ignores the result (the server rate-limits). For signup, keep `viewModel.resendOtp(email)`.
   - Title: login shows "Enter your login code"; signup keeps "Verify your email".
   - On a refusal with `isSessionActiveElsewhere` or `isAccountBlocked`, call the existing `showLoginRefusedDialog(context, refusal)` instead of the inline error. All other refusals stay as the inline red error.
   - Do not keep the password after the screen is disposed (it is a constructor field only; no storage).

5. **`Sign_in_screen.dart` `_loginWithEmail`:** stop calling `_signIn` for the password step.
   - Validate that email and password are filled (as now).
   - Set `_finishing = true`, call `viewModel.loginWithEmail(email, password)`, then `_finishing = false` when it returns.
   - `null` → `Navigator.push(OtpScreen(email: email, password: password, isLogin: true))`.
   - `refusal.isEmailNotVerified` → keep today's behaviour: `viewModel.resendOtp(email)` then push `OtpScreen(email: email)` (signup verification, `isLogin: false`).
   - Any other refusal → `showLoginRefusedDialog(context, refusal)`.
   - The Google and Apple buttons keep using `_signIn` unchanged.

## Must not change
- Google sign-in, sign-up, sign-up OTP verification, Forgot Password screens and their endpoints.
- Token storage (`LocalStorage.saveAccessToken/saveRefreshToken` inside `_signInToBackend`) and `AuthProvider.adoptSession`.
- No password or code is ever written to `LocalStorage`, logs or analytics.

## Test checklist
1. Correct email + password → OTP screen titled "Enter your login code"; code arrives by email; entering it lands on home.
2. Wrong password → "Invalid email or password" sheet; no email sent.
3. Wrong code → inline "That code is not right. 4 tries left."; 5 wrong codes → "Too many wrong codes. Ask for a new one."
4. Resend after 60 seconds → a new email; the old code no longer works.
5. Account signed in on another device → the existing "Already signed in" sheet appears after the code.
6. Unverified sign-up account logging in → goes to the signup verification screen (as today).
7. Google sign-in, sign-up and Forgot Password behave exactly as before.
8. `flutter analyze lib` shows no new errors or warnings.
