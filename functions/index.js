// ─── ENROLLMENT PAYMENT VERIFICATION ─────────────────────────────────
//
// Replaces the old client-side activateEnrollment() write. The client
// can no longer flip an enrollment to "active" directly (see
// firestore.rules) — it must call this function with the Paystack
// reference, and this function is the only thing allowed to activate
// a paid enrollment, because it's the only place that holds the
// Paystack SECRET key and can verify the transaction actually happened.
//
// Setup (one-time):
//   cd functions
//   npm install
//   firebase functions:secrets:set PAYSTACK_SECRET_KEY
//   (paste your sk_live_... or sk_test_... key when prompted — get it
//    from https://dashboard.paystack.com/#/settings/developer)
//
// Deploy:
//   firebase deploy --only functions

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_SECRET_KEY");

export const verifyEnrollmentPayment = onCall(
  { secrets: [PAYSTACK_SECRET_KEY], region: "us-central1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const { courseId, reference } = request.data || {};
    if (!courseId || typeof courseId !== "string") {
      throw new HttpsError("invalid-argument", "courseId is required.");
    }
    if (!reference || typeof reference !== "string") {
      throw new HttpsError("invalid-argument", "Paystack reference is required.");
    }

    const enrollmentId = `${uid}_${courseId}`;
    const enrollmentRef = db.collection("enrollments").doc(enrollmentId);
    const courseRef = db.collection("courses").doc(courseId);

    const [enrollmentSnap, courseSnap] = await Promise.all([
      enrollmentRef.get(),
      courseRef.get(),
    ]);

    if (!courseSnap.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }
    if (!enrollmentSnap.exists) {
      throw new HttpsError("failed-precondition", "No pending enrollment found. Start enrollment first.");
    }

    const enrollment = enrollmentSnap.data();
    if (enrollment.userId !== uid) {
      throw new HttpsError("permission-denied", "This enrollment doesn't belong to you.");
    }
    if (enrollment.status === "active") {
      // Already activated (e.g. duplicate call) — treat as success, no-op.
      return { status: "active", alreadyActive: true };
    }
    if (enrollment.status !== "pending_payment") {
      throw new HttpsError("failed-precondition", `Enrollment is in unexpected state: ${enrollment.status}`);
    }

    // Reject replay of a reference already used on a different enrollment.
    const refUsedSnap = await db
      .collection("enrollments")
      .where("paymentRef", "==", reference)
      .limit(1)
      .get();
    if (!refUsedSnap.empty && refUsedSnap.docs[0].id !== enrollmentId) {
      throw new HttpsError("already-exists", "This payment reference has already been used.");
    }

    const course = courseSnap.data();
    const expectedKobo = Math.round((Number(course.price) || 0) * 100);

    // ── Verify with Paystack (server-side, secret key never touches client) ──
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}` } }
    );

    if (!verifyRes.ok) {
      throw new HttpsError("internal", `Paystack verify request failed (${verifyRes.status}).`);
    }
    const verifyJson = await verifyRes.json();
    const tx = verifyJson?.data;

    if (!verifyJson?.status || !tx) {
      throw new HttpsError("failed-precondition", "Paystack could not verify this transaction.");
    }
    if (tx.status !== "success") {
      throw new HttpsError("failed-precondition", `Payment not successful (status: ${tx.status}).`);
    }
    if (tx.amount !== expectedKobo) {
      throw new HttpsError(
        "failed-precondition",
        `Amount mismatch: paid ${tx.amount}, expected ${expectedKobo}.`
      );
    }
    if ((tx.currency || "NGN") !== "NGN") {
      throw new HttpsError("failed-precondition", "Unexpected currency.");
    }

    await enrollmentRef.update({
      status: "active",
      paymentRef: reference,
      activatedAt: FieldValue.serverTimestamp(),
      verifiedAmountKobo: tx.amount,
    });

    return { status: "active", alreadyActive: false };
  }
);

// Free courses (price === 0) skip Paystack entirely — but activation
// still goes through the Admin SDK here rather than a client write, so
// there's exactly one place that's allowed to set status: "active",
// and someone can't use this path to sneak into a paid course (the
// course price is re-checked server-side, not trusted from the client).
export const verifyFreeEnrollment = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const { courseId } = request.data || {};
    if (!courseId || typeof courseId !== "string") {
      throw new HttpsError("invalid-argument", "courseId is required.");
    }

    const enrollmentId = `${uid}_${courseId}`;
    const enrollmentRef = db.collection("enrollments").doc(enrollmentId);
    const courseRef = db.collection("courses").doc(courseId);
    const [enrollmentSnap, courseSnap] = await Promise.all([
      enrollmentRef.get(),
      courseRef.get(),
    ]);

    if (!courseSnap.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }
    const course = courseSnap.data();
    if ((Number(course.price) || 0) > 0) {
      throw new HttpsError("failed-precondition", "This course is not free — use verifyEnrollmentPayment.");
    }
    if (!enrollmentSnap.exists) {
      throw new HttpsError("failed-precondition", "No pending enrollment found. Start enrollment first.");
    }
    const enrollment = enrollmentSnap.data();
    if (enrollment.userId !== uid) {
      throw new HttpsError("permission-denied", "This enrollment doesn't belong to you.");
    }
    if (enrollment.status === "active") {
      return { status: "active", alreadyActive: true };
    }

    await enrollmentRef.update({
      status: "active",
      paymentRef: "free",
      activatedAt: FieldValue.serverTimestamp(),
    });

    return { status: "active", alreadyActive: false };
  }
);
