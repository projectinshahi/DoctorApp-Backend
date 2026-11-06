# Student app (dr_app): emailed code on every email + password login (logic + UI)

## Goal
Email + password login becomes two steps:
1. Student enters email and password on the **Log in** screen and taps **Login**.
2. Server checks the password and **emails a 6-digit code**. It returns **no tokens**.
3. App opens the **login code screen**. The right code signs the student in and lands on home (or the course picker for an account without a course, exactly as today after login).

Do not change: Google sign-in, Apple button, sign-up, sign-up code verification, Forgot Password, token storage, `AuthProvider.adoptSession`, `AuthGate`.

## Backend contract (`$baseUrl` = `ApiConstant.baseUrl`)

### Step 1 — `POST $baseUrl/auth/login`
Body unchanged: `{ "email", "password", "deviceId" }`

| Status | Body | App does |
|---|---|---|
| **200** | `{ "otpRequired": true, "message": "We emailed you a 6-digit code.", "otpExpiresInSeconds": 600, "resendAfterSeconds": 60 }` — **no tokens** | Open the login code screen |
| 401 | `error.code = "INVALID_CREDENTIALS"`, message "Invalid email or password" | Existing refusal sheet |
| 403 | `error.code = "EMAIL_NOT_VERIFIED"` | Existing behaviour: `resendOtp(email)` then sign-up `OtpScreen(email)` |
| 403 | `error.code = "ACCOUNT_DEACTIVATED"` | Existing refusal sheet |

**Resend** = call `POST /auth/login` again with the same email and password. The server sends at most one new code a minute while the previous one is unused; inside the minute it still answers 200 and sends nothing.

### Step 2 — `POST $baseUrl/auth/login/verify-otp`
Body: `{ "email", "code", "deviceId" }`

| Status | Body | App does |
|---|---|---|
| **200** | Same session reply as `/auth/google` and `/auth/verify-otp` (`accessToken`, `refreshToken`, `isNewUser`, `sessionId`, `notice`, `previousSession`, `signedOutOtherDevice`, `user`) | Signed in |
| 400 | `error.code = "INVALID_OTP"` + top-level `attemptsLeft` | Inline error (existing `_refusalFrom` already appends "N tries left.") |
| 400 | `error.code = "OTP_EXPIRED"` | Inline error + enable **Resend code** now |
| 429 | `error.code = "OTP_LOCKED"` | Inline error + enable **Resend code** now |
| 409 | `error.code = "SESSION_ACTIVE_ELSEWHERE"` + `retryAfterMinutes` | Existing `showLoginRefusedDialog` |
| 403 | `ACCOUNT_DEACTIVATED` / `EMAIL_NOT_VERIFIED` | Existing `showLoginRefusedDialog` |

## What exists today (reuse it)
- `lib/core/constant/api_constant.dart` — `login`, `verifyOtp`, `resendOtp`, `forgotPassword`, `resetPassword`.
- `lib/services/Auth_services.dart`
  - `_signInToBackend(url, payload)`: adds `deviceId`, posts, on 200 parses `AuthResultModel` and saves both tokens; otherwise throws `LoginRefusedException` via `_refusalFrom` (appends "N tries left." from `attemptsLeft`).
  - `loginWithEmail(email, password)` currently returns `Future<AuthResultModel>` via `_signInToBackend(ApiConstant.login, …)` — **must change** (step 1 no longer returns tokens).
  - `registerWithEmail` shows the pattern for a POST that returns no session.
  - `LoginRefusedException`: `code`, `message`, `retryAfterMinutes`, `isEmailNotVerified`, `isAccountBlocked` (true for `ACCOUNT_BLOCKED` and `ACCOUNT_DEACTIVATED`), `isSessionActiveElsewhere`.
- `lib/repository/google_sign_in_provider.dart` (`GoogleSignInIntergration`): `_signIn(fn)` manages `isLoading`, `refusal`, `errorMessage`, `authResult`. `registerWithEmail` returns `Future<LoginRefusedException?>`.
- `lib/view/Authendication/login/Sign_in_screen.dart`: `_loginWithEmail(viewModel)` → `_signIn(viewModel, () => viewModel.loginWithEmail(…))`. `_signIn` handles `isEmailNotVerified` (resend + push `OtpScreen`), other refusals (`showLoginRefusedDialog`), success (`adoptSession` → `popUntil(first)`). `_finishing` drives the full-screen `AppLoadingScreen('Signing you in…')`.
- `lib/view/Authendication/login/otp_screen.dart` — `OtpScreen(email)` for sign-up: title "Verify your email", subtitle with the email, one wide 6-digit field (digits only, max 6, `letterSpacing: 12`, `autofillHints: oneTimeCode`, auto-submits at 6 digits), red border + red inline error, **Verify** button, "Resend code in Ns" → "Resend code" (60 s timer), snackbar "A new code is on its way.", `AppLoadingScreen('Signing you in…')` while verifying.
- Styling: `AppColor.Screenbackground`, `AppColor.buttoncolor`, `AppColor.Buttontextcolor`, `AppColor.Textcolor`, `AppSize.screenHorizontal/screenVertical/gap`, `flutter_screenutil` (`.w/.h/.sp/.r`), back arrow `asset/icons/Backarrow.png`.

## Logic changes

1. **`api_constant.dart`** — add `static const String loginVerifyOtp = '$baseUrl/auth/login/verify-otp';`

2. **`Auth_services.dart`**
   - `loginWithEmail(email, password)` → `Future<void>`: get `deviceId` from `DeviceIdHelper.getDeviceId()`, POST `{email, password, deviceId}` to `ApiConstant.login`. Return normally only when status is 200 **and** `otpRequired == true`. Anything else: `throw _refusalFrom(response, "Could not sign in. Please try again.")`. Debug-log only the status, never the body.
   - Add `Future<AuthResultModel> verifyLoginOtp(String email, String code) => _signInToBackend(ApiConstant.loginVerifyOtp, {"email": email, "code": code});`

3. **`google_sign_in_provider.dart`**
   - `loginWithEmail` → `Future<LoginRefusedException?>` (null = code sent), same pattern as `registerWithEmail`, **not** through `_signIn` (no session yet). Set `isLoading` true/false with `notifyListeners()`. Network errors → `LoginRefusedException(code: null, message: 'Could not reach the server. Check your connection and try again.')`.
   - Add `Future<bool> verifyLoginOtp(String email, String code) => _signIn(() => _authService.verifyLoginOtp(email, code));`

4. **`Sign_in_screen.dart` `_loginWithEmail`** — stop using `_signIn` for the password step:
   - Empty email/password → existing snackbar.
   - `setState(_sendingCode = true)` → `final refused = await viewModel.loginWithEmail(email, password)` → `_sendingCode = false`.
   - `null` → `Navigator.push(OtpScreen(email: email, password: password, isLogin: true))`.
   - `refused.isEmailNotVerified` → `await viewModel.resendOtp(email)` then push `OtpScreen(email: email)` (sign-up mode, unchanged).
   - other refusal → `showLoginRefusedDialog(context, refused)`.
   - Google and Apple keep `_signIn` unchanged.

5. **`otp_screen.dart`** — one screen, two modes. Add constructor params `final bool isLogin;` (default `false`) and `final String? password;` (login only; constructor field, never stored).
   - Verify: `isLogin ? viewModel.verifyLoginOtp(email, code) : viewModel.verifyOtp(email, code)`.
   - Resend: `isLogin ? viewModel.loginWithEmail(email, password!) : viewModel.resendOtp(email)`; ignore the result; clear the field, clear the error, restart the timer, show the existing snackbar.
   - Refusal with `isSessionActiveElsewhere` or `isAccountBlocked` → `showLoginRefusedDialog(context, refusal)` (then stay on the screen). Every other refusal → existing inline red error.
   - On `OTP_EXPIRED` or `OTP_LOCKED`, end the timer so **Resend code** is enabled immediately.
   - Success → existing path: `AuthProvider.adoptSession(result)` → `popUntil(first)`.

## UI

Keep the existing OTP screen's look so sign-up, login and Forgot Password feel like one family. Only the texts and the busy states differ.

### Log in screen (`Sign_in_screen.dart`)
- While the code is being requested, the **Login** button shows a white `CircularProgressIndicator` (size ~22, stroke 2.5) in place of the "Login" text, and is not tappable. No full-screen overlay for this step (nothing is signed in yet).
- Email and password fields, Forgot Password, Google and Apple buttons: unchanged.

### Login code screen (`OtpScreen` with `isLogin: true`)
Top to bottom, same paddings and colours as the sign-up mode:

1. **App bar:** existing back arrow (returns to Log in with email and password still filled).
2. **Title** (24.sp, w600, `AppColor.Textcolor`): **"Enter your login code"** (sign-up mode keeps "Verify your email").
3. **Subtitle** (15.sp): **"We sent a 6-digit code to"** then on the next line the email in w600. Below it a small text button **"Not you? Change email"** (14.sp, underlined, `AppColor.Textcolor`) that pops back to Log in.
4. **Code field:** existing wide 6-digit field (autofocus, number keyboard, `oneTimeCode` autofill, auto-submit at 6 digits). Hint `••••••`.
5. **Inline error** under the field (14.sp, `Colors.red.shade700`), field border turns red; clears as soon as the student types.
6. **Verify button** (existing style): label **"Verify and log in"** in login mode, "Verify" in sign-up mode.
7. **Resend row:** "Resend code in 42s" (grey) → **"Resend code"** (enabled, `AppColor.Textcolor`). After a resend: snackbar "A new code is on its way."
8. **Help line** at the bottom (13.sp, grey): **"The code expires in 10 minutes. Check your spam folder if you don't see it."**
9. While verifying: existing full-screen `AppLoadingScreen(message: 'Signing you in…')`.

### Error texts the student sees
| Server code | Shown as |
|---|---|
| `INVALID_OTP` | Inline: "That code is not right. 4 tries left." |
| `OTP_EXPIRED` | Inline: "This code has expired. Ask for a new one." + Resend enabled |
| `OTP_LOCKED` | Inline: "Too many wrong codes. Ask for a new one." + Resend enabled |
| `SESSION_ACTIVE_ELSEWHERE` | Existing "Already signed in" sheet |
| `ACCOUNT_DEACTIVATED` | Existing "Account disabled" sheet |
| Network failure | Inline: "Could not reach the server. Check your connection and try again." |

## Rules
- Never write the password or the code to `LocalStorage`, logs, analytics or crash reports.
- Small screens (iPhone SE): the code screen scrolls; nothing overflows with the keyboard open.
- Keep existing tests in `test/` passing; add a widget test for `OtpScreen(isLogin: true)` showing "Enter your login code" and "Verify and log in" if practical.

## Test checklist
1. Correct email + password → Login button spins → login code screen with the email shown → code arrives (check spam) → "Verify and log in" → home.
2. Wrong password → "Invalid email or password" sheet; no email sent; no code screen.
3. Wrong code → "That code is not right. 4 tries left."; 5 wrong → "Too many wrong codes…" and Resend enabled.
4. Resend after 60 s → new email; old code no longer works.
5. "Not you? Change email" and the back arrow return to Log in with the fields still filled.
6. Account signed in on another device → "Already signed in" sheet after the code.
7. Never-verified sign-up account → goes to sign-up "Verify your email" screen, as today.
8. Google, Apple, sign-up and Forgot Password unchanged.
9. `flutter analyze lib` — no new errors or warnings.

## Before testing
The live server does not have step 1/step 2 yet (backend branch `login-otp`). Test against the backend run locally (`npm run dev` on `login-otp`) with `ApiConstant.host` set to `http://10.0.2.2:3000` (Android emulator) or `http://localhost:3000` (iOS Simulator), and put the Render URL back before committing.
