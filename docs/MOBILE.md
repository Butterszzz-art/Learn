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

## 2. App Store and Play Store (needs your accounts and tools)

`capacitor.config.json` is set up to wrap the deployed site in a native shell with [Capacitor](https://capacitorjs.com). The native projects are **not** generated or committed — that step needs Xcode (on a Mac) and Android Studio, and store accounts only you can create.

1. Deploy the site and put its address in `capacitor.config.json` under `server.url`.
2. Install the tooling:

   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
   ```

3. Generate the native projects:

   ```bash
   npx cap add android
   ```

   ```bash
   npx cap add ios
   ```

4. Open them (`npx cap open android`, `npx cap open ios`), set the app icon and splash screen, and build.

Things to know before submitting:

- **Apple requires more than a wrapped website.** Review guideline 4.2 rejects apps that are only a web view. Plan to add at least native push (`@capacitor/push-notifications`), the native share sheet and haptics before submitting to the App Store. Google Play is more lenient; a Trusted Web Activity built with Bubblewrap is the lightest route there.
- **Payments.** Digital subscriptions sold inside an iOS or Android app must use the store's own in-app purchase system. The web app's upgrade page is a link to an external checkout, which is fine on the web but not inside a store build. RevenueCat is the usual way to handle both stores.
- **Sign in with Apple.** Only required if you add third-party sign-in such as Google. Email and password alone is fine.
- **Account deletion** is required by both stores and is already in Settings.
- **Privacy labels.** The data collected is listed in `/privacy`: email, learning activity, things the user writes, uploads.
- **Costs:** Apple Developer Program is $99 a year; Google Play is a one-time $25.
