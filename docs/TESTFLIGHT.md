# Shipping Neuron to TestFlight

The iOS app is a native shell (Capacitor 8) around the deployed site,
`https://learn-n6r5.vercel.app`. It adds a native share sheet, haptics, an
in-app browser for outside links, a splash screen and an offline screen. The
Xcode project is committed in `ios/`.

You don't need a Mac. The **iOS → TestFlight** GitHub Actions workflow builds
the app on a GitHub-hosted Mac, signs it with Apple's cloud-managed
certificates, and uploads it to App Store Connect.

## One-time setup (about 20 minutes)

### 1. Register the bundle ID

[developer.apple.com → Identifiers](https://developer.apple.com/account/resources/identifiers/list) → **+** → App IDs → App.

- Description: `Neuron`
- Bundle ID (Explicit): `app.neuron.learn`
- No extra capabilities are needed.

### 2. Create the app in App Store Connect

[appstoreconnect.apple.com → Apps](https://appstoreconnect.apple.com/apps) → **+** → New App.

- Platform: iOS
- Name: `Neuron` (must be unique on the App Store; if it's taken, try something like "Neuron: Swipe Science". This is only the store name; the name under the icon stays "Neuron")
- Primary language: English
- Bundle ID: `app.neuron.learn`
- SKU: anything, e.g. `neuron-ios`

### 3. Create an App Store Connect API key

App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API** → Team Keys → **+**.

- Name: `GitHub Actions`
- Access: **Admin**. This is needed so the build can create the
  distribution certificate and provisioning profile for you.

Download the `.p8` file (Apple only lets you download it once). Note the
**Key ID** and the **Issuer ID** shown above the key list.

### 4. Find your Team ID

[developer.apple.com → Membership details](https://developer.apple.com/account#MembershipDetailsCard): the 10-character **Team ID**.

### 5. Add four repository secrets

GitHub → this repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name | Value |
|---|---|
| `APPLE_TEAM_ID` | Team ID from step 4 |
| `ASC_KEY_ID` | Key ID from step 3 |
| `ASC_ISSUER_ID` | Issuer ID from step 3 |
| `ASC_KEY_P8` | The whole contents of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines |

## Upload a build

1. Make sure the web changes are deployed: the app shows whatever is live at
   `learn-n6r5.vercel.app`, so merge to `main` and let Vercel deploy first.
2. GitHub → **Actions** → **iOS → TestFlight** → **Run workflow**. Leave
   "version" empty to use 1.0, or type a new one like `1.1`.
3. It takes about 10–15 minutes. When it finishes green, Apple processes the
   build for another 5–30 minutes, then it shows under the app's
   **TestFlight** tab.

Build numbers come from the workflow's run number, so every run uploads a
new, higher build.

## Testers

- **Internal testing** (up to 100 people on your App Store Connect team): no
  review. TestFlight tab → Internal Testing → **+** → add yourself and others.
  Install the TestFlight app on the iPhone and accept the invite.
- **External testing** (up to 10,000 people via email or a public link): the
  first build goes through Beta App Review (usually under a day). Apple will
  ask for:
  - **Sign-in information:** create a reviewer account on the live site and
    give its email and password. Make sure it has finished onboarding and the
    feed has cards in it.
  - **Contact details** and **what to test**, e.g. "Swipe the feed, answer a
    quick check, open a deep dive, save and share a card, run a review."
  - **Privacy policy URL:** `https://learn-n6r5.vercel.app/privacy`

The first time you upload, App Store Connect may ask about export
compliance. The app declares it uses no non-exempt encryption
(`ITSAppUsesNonExemptEncryption` = NO), so the question shouldn't appear.

## What the app changes compared with the website

Detected by the `NeuronApp` marker the app adds to its user agent
(`src/lib/nativeApp.ts`) and by Capacitor in the page (`src/lib/native.ts`):

- **Upgrade page:** no link to an outside checkout (App Store rule 3.1.1). It
  says Pro isn't available in the app yet. Selling Pro in the app will need
  Apple in-app purchase (RevenueCat is the usual route).
- **Daily reminder:** hidden, since web push doesn't work inside an app.
  Native push needs an APNs key and `@capacitor/push-notifications`, a
  later step.
- **Share** opens the iOS share sheet; **save** and **quick-check answers**
  give haptic feedback; **links to other sites** open in an in-app Safari
  sheet; **no connection** shows `capacitor-shell/offline.html`.

## Before a public App Store release (not needed for TestFlight)

- **Guideline 4.2 (minimum functionality).** Apple sometimes rejects apps
  that mainly show a website. The native share sheet, haptics, in-app
  browser and offline screen help. Native push reminders would help more.
- Screenshots (6.9" iPhone and 13" iPad, since the app runs on iPad), a
  description, keywords, an age rating, and the App Privacy answers. The data
  collected is listed on `/privacy`.
- In-app purchase if Pro is sold in the app.

## Changing the iOS project

- After changing `capacitor.config.json` or adding a Capacitor plugin:
  `npx cap sync ios` (CI also runs this on every build).
- App icon and splash: edit `assets/icon.svg`, then
  `npm run ios:assets`.
- If the site moves to a new domain, update `server.url` in
  `capacitor.config.json` and the "Try again" link in
  `capacitor-shell/offline.html`.
