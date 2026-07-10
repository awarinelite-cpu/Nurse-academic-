// ─── ONE-TIME MIGRATION: nv/shared users[] → Firebase Auth + users/{uid} ──
//
// Run this ONCE, locally, from your own machine — never in CI, never
// committed with real output, never with the service account key in
// this repo.
//
// SETUP:
//   1. Firebase Console → Project Settings → Service Accounts
//      → "Generate new private key" → save the JSON somewhere OUTSIDE
//      this repo, e.g. ~/keys/medicare-c6196-admin.json
//   2. Firebase Console → Authentication → Sign-in method
//      → Enable "Email/Password"
//   3. Run:
//        GOOGLE_APPLICATION_CREDENTIALS=~/keys/medicare-c6196-admin.json \
//        node scripts/migrateUsersToAuth.js
//
// WHAT IT DOES:
//   - Reads the existing users[] array from Firestore doc nv/shared
//   - For each user, creates a real Firebase Auth account using their
//     EXISTING plaintext password (Admin SDK hashes it properly on
//     creation — no forced password reset for anyone)
//   - Writes a matching profile doc to users/{uid} with role, class,
//     matricNumber, displayName, etc.
//   - Idempotent: safe to re-run — skips any email that already has
//     an Auth account, and skips writing a duplicate users/{uid} doc
//   - Never deletes or modifies nv/shared — the old data stays intact
//     as a fallback until you've verified the migration.
//
// AFTER RUNNING:
//   - Spot-check a few accounts in Firebase Console → Authentication
//   - Spot-check a few users/{uid} docs in Firestore
//   - Only then proceed to the auth-UI rewrite step.

const admin = require("firebase-admin");

// ── CONFIG: pick which project you're migrating ──────────────────────
// Run once per project if you use both (medicare-c6196 and
// nurseexamprep-6956a are separate Firebase projects with separate
// Auth users and separate Firestore data).
const PROJECT_LABEL = process.env.MIGRATE_PROJECT || "main"; // "main" | "clone"

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const auth = admin.auth();

const MIN_PASSWORD_LENGTH = 6; // Firebase Auth's hard minimum

async function migrate() {
  console.log(`\n[Migration] Starting for project: ${PROJECT_LABEL}\n`);

  const sharedSnap = await db.collection("nv").doc("shared").get();
  if (!sharedSnap.exists) {
    console.error("[Migration] nv/shared document not found. Aborting.");
    process.exit(1);
  }

  const users = sharedSnap.data().users || [];
  console.log(`[Migration] Found ${users.length} user record(s) in nv/shared.\n`);

  const results = { created: 0, skipped: 0, failed: [], weakPassword: [] };

  for (const u of users) {
    const email = (u.username || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      results.failed.push({ email: u.username, reason: "invalid email format" });
      continue;
    }
    if (!u.password || u.password.length < MIN_PASSWORD_LENGTH) {
      results.weakPassword.push(email);
      // Still create the account, but with a random temp password —
      // these users will need "Forgot password" to set a new one,
      // since Firebase Auth requires 6+ characters.
    }

    // Skip if already migrated
    let existingUid = null;
    try {
      const existing = await auth.getUserByEmail(email);
      existingUid = existing.uid;
    } catch (e) {
      if (e.code !== "auth/user-not-found") {
        results.failed.push({ email, reason: e.message });
        continue;
      }
    }

    let uid = existingUid;
    if (!uid) {
      try {
        const password = (u.password && u.password.length >= MIN_PASSWORD_LENGTH)
          ? u.password
          : require("crypto").randomBytes(9).toString("base64"); // temp — needs reset
        const created = await auth.createUser({
          email,
          password,
          displayName: u.displayName || email.split("@")[0],
        });
        uid = created.uid;
        results.created++;
        console.log(`[Migration] Created Auth account: ${email} → ${uid}`);
      } catch (e) {
        results.failed.push({ email, reason: e.message });
        continue;
      }
    } else {
      results.skipped++;
    }

    // Write/merge the profile doc — safe to re-run
    try {
      await db.collection("users").doc(uid).set({
        username: email, // kept for backward-compat lookups elsewhere in the app
        displayName: u.displayName || email.split("@")[0],
        role: u.role || "student",
        class: u.class || "",
        isPublicHealth: !!u.isPublicHealth,
        matricNumber: u.matricNumber || "",
        joined: u.joined || null,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      results.failed.push({ email, reason: `profile write failed: ${e.message}` });
    }
  }

  console.log("\n─── Migration summary ───────────────────────────");
  console.log(`Created:        ${results.created}`);
  console.log(`Already existed:${results.skipped}`);
  console.log(`Weak/temp pw:   ${results.weakPassword.length}${results.weakPassword.length ? " (must use 'Forgot password' to set a new one): " + results.weakPassword.join(", ") : ""}`);
  console.log(`Failed:         ${results.failed.length}`);
  if (results.failed.length) {
    results.failed.forEach(f => console.log(`  - ${f.email}: ${f.reason}`));
  }
  console.log("──────────────────────────────────────────────────\n");
}

migrate().then(() => process.exit(0)).catch(e => {
  console.error("[Migration] Fatal error:", e);
  process.exit(1);
});
