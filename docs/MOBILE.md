# Getting Neuron onto phones

There are two routes. The first works today with no extra steps.

## 1. Installable web app (ready now)

Once the site is deployed over HTTPS:

- **Android / desktop Chrome:** the browser offers "Install app".
- **iPhone / iPad:** Share → Add to Home Screen.

It then opens full-screen with its own icon. Included:

- App manifest and icons (`src/app/manifest.ts`, `src/app/icons/`).
- Service worker (`public/sw.js`): cards already loaded stay usable offline, deep dives you have opened can be re-read offline, and there is an offline screen.
- Push notifications (optional): generate keys with `npm run push:keys`, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` on the server, and a "One daily reminder" option appears in Settings. On iPhone, push only works after the app has been added to the Home Screen (iOS 16.4 or later).

## 2. iOS app (TestFlight)

The iOS project is in `ios/` and builds in GitHub Actions; no Mac needed. Setup and upload steps: [TESTFLIGHT.md](TESTFLIGHT.md).

## 3. Google Play (not set up)

Google Play is more lenient than Apple about wrapped sites; a Trusted Web Activity built with Bubblewrap is the lightest route. Or `npm install @capacitor/android`, `npx cap add android`, and open it in Android Studio. Google Play costs a one-time $25.

Things to know for either store:

- **Payments.** Digital subscriptions sold inside an iOS or Android app must use the store's own in-app purchase system. The iOS app already hides the outside checkout link. RevenueCat is the usual way to handle both stores.
- **Sign in with Apple.** Only required if you add third-party sign-in such as Google. Email and password alone is fine.
- **Account deletion** is required by both stores and is already in Settings.
- **Privacy labels.** The data collected is listed in `/privacy`: email, learning activity, things the user writes, uploads.
