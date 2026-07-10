import { useState, useEffect } from "react";
import {
  createCourse, updateCourse, deleteCourse, listCourses, listLecturers, getCourse,
  createModule, updateModule, deleteModule, subscribeModules,
  createLesson, updateLesson, deleteLesson, subscribeLessons,
  subscribeCourses, createPendingEnrollment, activateEnrollment, getEnrollment,
} from "../../services/courses";
import { auth } from "../../config/firebaseClient";
import { loadPaystack } from "../../services/paystackService";
import { PAYSTACK_PUBLIC_KEY } from "../../config/keys";
import { asgSave, asgSubscribeByCourse, asgSubmit, asgLoadMySubmission, asgLoadSubmissions, asgGrade } from "../../services/backend";
import { ls } from "../../utils/storage";

// ═══════════════════════════════════════════════════════════════════
// CourseManager — admin/lecturer UI to create and manage courses,
// their modules, and lessons (video / reading / live).
// ═══════════════════════════════════════════════════════════════════
export function CourseManager({ toast, currentUser, isAdmin }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lecturers, setLecturers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [openCourse, setOpenCourse] = useState(null); // courseId whose modules are expanded
  const [openAssignments, setOpenAssignments] = useState(null); // courseId whose assignments are expanded

  const blank = { title: "", description: "", instructorId: "", price: 0, status: "draft" };
  const [form, setForm] = useState(blank);

  const refresh = () => {
    setLoading(true);
    listCourses().then(cs => { setCourses(cs); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { refresh(); listLecturers().then(setLecturers).catch(() => {}); }, []);

  const save = async () => {
    if (!form.title.trim()) return toast("Course title required", "error");
    try {
      const instructor = lecturers.find(l => l.uid === form.instructorId);
      const payload = {
        title: form.title, description: form.description,
        instructorId: form.instructorId || null,
        instructorName: instructor ? (instructor.displayName || instructor.username) : "",
        price: form.price, status: form.status,
      };
      if (edit) {
        await updateCourse(edit, payload);
        toast("Course updated", "success");
      } else {
        await createCourse(payload);
        toast("Course created", "success");
      }
      setShowModal(false); setEdit(null); setForm(blank);
      refresh();
    } catch (e) {
      toast("Save failed: " + e.message, "error");
    }
  };

  const startEdit = (c) => {
    setForm({ title: c.title, description: c.description || "", instructorId: c.instructorId || "", price: c.price || 0, status: c.status || "draft" });
    setEdit(c.id); setShowModal(true);
  };

  const del = async (c) => {
    if (!window.confirm(`Delete "${c.title}"? This does not delete its modules/lessons — remove those first.`)) return;
    try { await deleteCourse(c.id); toast("Course deleted", "success"); refresh(); }
    catch (e) { toast("Delete failed: " + e.message, "error"); }
  };

  if (!isAdmin) return <div className="card">Only admins can manage courses.</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div className="sec-title">🎓 Courses ({courses.length})</div>
        <button className="btn btn-purple" onClick={() => { setShowModal(true); setEdit(null); setForm(blank); }}>+ New Course</button>
      </div>

      {loading ? <div className="card">Loading…</div> : courses.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--text3)" }}>No courses yet — create your first one.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {courses.map(c => (
            <div key={c.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>
                    {c.title}{" "}
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 20, marginLeft: 6,
                      background: c.status === "published" ? "var(--success-bg,#dcfce7)" : "var(--warn-bg,#fef3c7)",
                      color: c.status === "published" ? "#16a34a" : "#b45309",
                    }}>{c.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                    {c.instructorName || "No instructor assigned"} • ₦{Number(c.price || 0).toLocaleString()}
                  </div>
                  {c.description && <div style={{ fontSize: 12.5, marginTop: 6 }}>{c.description}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-sm" onClick={() => setOpenCourse(openCourse === c.id ? null : c.id)}>
                    {openCourse === c.id ? "▲ Hide" : "▼ Modules"}
                  </button>
                  <button className="btn btn-sm" onClick={() => setOpenAssignments(openAssignments === c.id ? null : c.id)}>
                    {openAssignments === c.id ? "▲ Hide" : "📝 Assignments"}
                  </button>
                  <button className="btn btn-sm" onClick={() => startEdit(c)}>✏️ Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => del(c)}>🗑️</button>
                </div>
              </div>
              {openCourse === c.id && <ModuleManager courseId={c.id} toast={toast} />}
              {openAssignments === c.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border,#eee)" }}>
                  <CourseAssignments courseId={c.id} currentUser={currentUser} isStaff={true} toast={toast} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{edit ? "Edit Course" : "New Course"}</div>
            <label className="lbl">Title</label>
            <input className="inp" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Fundamentals of Community Health Nursing" />
            <label className="lbl">Description</label>
            <textarea className="inp" style={{ minHeight: 80 }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <label className="lbl">Instructor</label>
            <select className="inp" value={form.instructorId} onChange={e => setForm(f => ({ ...f, instructorId: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {lecturers.map(l => <option key={l.uid} value={l.uid}>{l.displayName || l.username}</option>)}
            </select>
            <label className="lbl">Price (₦)</label>
            <input className="inp" type="number" min="0" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            <label className="lbl">Status</label>
            <select className="inp" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="draft">Draft (hidden from catalog)</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn btn-purple" onClick={save}>{edit ? "Save Changes" : "Create Course"}</button>
              <button className="btn" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ModuleManager — modules + lessons for one course, shown inline
// when a course row is expanded.
// ═══════════════════════════════════════════════════════════════════
function ModuleManager({ courseId, toast }) {
  const [modules, setModules] = useState([]);
  const [newModTitle, setNewModTitle] = useState("");
  const [openModule, setOpenModule] = useState(null);

  useEffect(() => {
    const unsub = subscribeModules(courseId, setModules);
    return unsub;
  }, [courseId]);

  const addModule = async () => {
    if (!newModTitle.trim()) return;
    try {
      await createModule(courseId, { title: newModTitle, order: modules.length });
      setNewModTitle("");
    } catch (e) { toast("Failed to add module: " + e.message, "error"); }
  };

  const renameModule = async (m) => {
    const title = window.prompt("Module title:", m.title);
    if (title === null || !title.trim()) return;
    await updateModule(courseId, m.id, { title: title.trim() }).catch(e => toast(e.message, "error"));
  };

  const removeModule = async (m) => {
    if (!window.confirm(`Delete module "${m.title}"? Delete its lessons first if any exist.`)) return;
    await deleteModule(courseId, m.id).catch(e => toast(e.message, "error"));
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border,#eee)" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input className="inp" style={{ margin: 0 }} placeholder="New module title (e.g. Week 1 — Introduction)"
          value={newModTitle} onChange={e => setNewModTitle(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addModule()} />
        <button className="btn btn-sm btn-purple" onClick={addModule}>+ Add</button>
      </div>

      {modules.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--text3)" }}>No modules yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {modules.map(m => (
            <div key={m.id} style={{ background: "var(--bg2,#f8f8f8)", borderRadius: 10, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 13, cursor: "pointer" }} onClick={() => setOpenModule(openModule === m.id ? null : m.id)}>
                  {openModule === m.id ? "▼" : "▶"} {m.title}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button className="btn btn-sm" onClick={() => renameModule(m)}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={() => removeModule(m)}>🗑️</button>
                </div>
              </div>
              {openModule === m.id && <LessonManager courseId={courseId} moduleId={m.id} toast={toast} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LessonManager — lessons within one module. type: video/reading/live.
// ═══════════════════════════════════════════════════════════════════
function LessonManager({ courseId, moduleId, toast }) {
  const [lessons, setLessons] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const blank = { title: "", type: "video", videoUrl: "", textBody: "", liveLink: "", scheduledAt: "" };
  const [form, setForm] = useState(blank);

  useEffect(() => {
    const unsub = subscribeLessons(courseId, moduleId, setLessons);
    return unsub;
  }, [courseId, moduleId]);

  const save = async () => {
    if (!form.title.trim()) return toast("Lesson title required", "error");
    let content = {};
    if (form.type === "video") content = { videoUrl: form.videoUrl };
    else if (form.type === "reading") content = { textBody: form.textBody };
    else if (form.type === "live") content = { liveLink: form.liveLink, scheduledAt: form.scheduledAt };
    try {
      await createLesson(courseId, moduleId, { title: form.title, type: form.type, content, order: lessons.length });
      setForm(blank); setShowForm(false);
    } catch (e) { toast("Failed to add lesson: " + e.message, "error"); }
  };

  const removeLesson = async (l) => {
    if (!window.confirm(`Delete lesson "${l.title}"?`)) return;
    await deleteLesson(courseId, moduleId, l.id).catch(e => toast(e.message, "error"));
  };

  const typeIcon = { video: "🎬", reading: "📖", live: "🔴" };

  return (
    <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: "2px solid var(--border,#e5e5e5)" }}>
      {lessons.map(l => (
        <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 12.5 }}>
          <span>{typeIcon[l.type] || "📄"} {l.title}
            {l.type === "live" && l.content?.scheduledAt && <span style={{ color: "var(--text3)" }}> — {l.content.scheduledAt}</span>}
          </span>
          <button className="btn btn-sm btn-danger" onClick={() => removeLesson(l)}>🗑️</button>
        </div>
      ))}

      {!showForm ? (
        <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setShowForm(true)}>+ Add Lesson</button>
      ) : (
        <div style={{ marginTop: 8, background: "var(--card-bg,#fff)", borderRadius: 8, padding: 10 }}>
          <input className="inp" placeholder="Lesson title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <select className="inp" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="video">🎬 Video</option>
            <option value="reading">📖 Reading</option>
            <option value="live">🔴 Live Session</option>
          </select>
          {form.type === "video" && (
            <input className="inp" placeholder="Video URL (YouTube/Vimeo unlisted link)" value={form.videoUrl} onChange={e => setForm(f => ({ ...f, videoUrl: e.target.value }))} />
          )}
          {form.type === "reading" && (
            <textarea className="inp" style={{ minHeight: 100 }} placeholder="Lesson content (text)" value={form.textBody} onChange={e => setForm(f => ({ ...f, textBody: e.target.value }))} />
          )}
          {form.type === "live" && (
            <>
              <input className="inp" placeholder="Zoom / Google Meet link" value={form.liveLink} onChange={e => setForm(f => ({ ...f, liveLink: e.target.value }))} />
              <input className="inp" type="datetime-local" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
            </>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button className="btn btn-sm btn-purple" onClick={save}>Save Lesson</button>
            <button className="btn btn-sm" onClick={() => { setShowForm(false); setForm(blank); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CourseCatalog — student-facing browse view. Published courses only.
// ═══════════════════════════════════════════════════════════════════
export function CourseCatalog({ toast }) {
  const [courses, setCourses] = useState([]);
  const [openCourseId, setOpenCourseId] = useState(null);

  useEffect(() => {
    const unsub = subscribeCourses(setCourses, { publishedOnly: true });
    return unsub;
  }, []);

  if (openCourseId) {
    return <CourseDetail courseId={openCourseId} toast={toast} onBack={() => setOpenCourseId(null)} />;
  }

  return (
    <div>
      <div className="sec-title" style={{ marginBottom: 16 }}>🎓 Course Catalog</div>
      {courses.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--text3)" }}>No courses available yet — check back soon.</div>
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {courses.map(c => (
            <div key={c.id} className="card" style={{ cursor: "pointer" }} onClick={() => setOpenCourseId(c.id)}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{c.title}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>{c.instructorName || "Instructor TBA"}</div>
              {c.description && <div style={{ fontSize: 12.5, marginBottom: 10 }}>{c.description.slice(0, 100)}{c.description.length > 100 ? "…" : ""}</div>}
              <div style={{ fontWeight: 800, color: "var(--accent)" }}>{c.price > 0 ? `₦${Number(c.price).toLocaleString()}` : "Free"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CourseDetail — enrollment gate + module/lesson browser for one course.
// ═══════════════════════════════════════════════════════════════════
function CourseDetail({ courseId, toast, onBack }) {
  const [course, setCourse] = useState(null);
  const [modules, setModules] = useState([]);
  const [enrollment, setEnrollment] = useState(undefined); // undefined = loading, null = not enrolled
  const [enrolling, setEnrolling] = useState(false);
  const [activeLesson, setActiveLesson] = useState(null);
  const uid = auth.currentUser?.uid;

  useEffect(() => {
    getCourse(courseId).then(setCourse);
    const unsub = subscribeModules(courseId, setModules);
    if (uid) getEnrollment(uid, courseId).then(setEnrollment).catch(() => setEnrollment(null));
    else setEnrollment(null);
    return unsub;
  }, [courseId, uid]);

  const isEnrolled = enrollment?.status === "active";
  const isPending = enrollment?.status === "pending_payment";

  const enroll = async () => {
    if (!uid) return toast("Please sign in again", "error");
    setEnrolling(true);
    try {
      await createPendingEnrollment(uid, courseId);
      await loadPaystack();
      const handler = window.PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: auth.currentUser.email,
        amount: Math.round((course.price || 0) * 100), // kobo
        ref: `enroll_${courseId}_${Date.now()}`,
        callback: (response) => {
          activateEnrollment(uid, courseId, response.reference)
            .then(() => { setEnrollment({ status: "active", paymentRef: response.reference }); toast("🎉 Enrolled!", "success"); })
            .catch(e => toast("Payment succeeded but enrollment failed to activate: " + e.message, "error"));
        },
        onClose: () => setEnrolling(false),
      });
      handler.openIframe();
    } catch (e) {
      setEnrolling(false);
      toast("Enrollment failed: " + e.message, "error");
    }
  };

  const enrollFree = async () => {
    if (!uid) return toast("Please sign in again", "error");
    setEnrolling(true);
    try {
      await createPendingEnrollment(uid, courseId);
      await activateEnrollment(uid, courseId, "free");
      setEnrollment({ status: "active" });
      toast("🎉 Enrolled!", "success");
    } catch (e) {
      toast("Enrollment failed: " + e.message, "error");
    } finally {
      setEnrolling(false);
    }
  };

  const [tab, setTab] = useState("content"); // "content" | "assignments"

  if (!course) return <div className="card">Loading…</div>;

  if (activeLesson) {
    return <LessonPlayer lesson={activeLesson} onBack={() => setActiveLesson(null)} courseTitle={course.title} />;
  }

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>← Back to catalog</button>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{course.title}</div>
        <div style={{ fontSize: 13, color: "var(--text3)", margin: "4px 0 10px" }}>{course.instructorName || "Instructor TBA"}</div>
        {course.description && <div style={{ fontSize: 13.5, marginBottom: 12 }}>{course.description}</div>}

        {enrollment === undefined ? null : isEnrolled ? (
          <div style={{ fontWeight: 700, color: "var(--success)" }}>✅ You're enrolled</div>
        ) : isPending ? (
          <button className="btn btn-purple" onClick={enroll} disabled={enrolling}>
            {enrolling ? "Processing…" : `Finish Payment — ₦${Number(course.price || 0).toLocaleString()}`}
          </button>
        ) : course.price > 0 ? (
          <button className="btn btn-purple" onClick={enroll} disabled={enrolling}>
            {enrolling ? "Processing…" : `Enroll — ₦${Number(course.price).toLocaleString()}`}
          </button>
        ) : (
          <button className="btn btn-purple" onClick={enrollFree} disabled={enrolling}>
            {enrolling ? "Enrolling…" : "Enroll — Free"}
          </button>
        )}
      </div>

      {isEnrolled && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button className={`btn btn-sm${tab === "content" ? " btn-purple" : ""}`} onClick={() => setTab("content")}>📚 Content</button>
          <button className={`btn btn-sm${tab === "assignments" ? " btn-purple" : ""}`} onClick={() => setTab("assignments")}>📝 Assignments</button>
          <button className={`btn btn-sm${tab === "grades" ? " btn-purple" : ""}`} onClick={() => setTab("grades")}>📊 Grades</button>
        </div>
      )}

      {tab === "assignments" && isEnrolled ? (
        <CourseAssignments courseId={courseId} currentUser={auth.currentUser?.email} isStaff={false} toast={toast} />
      ) : tab === "grades" && isEnrolled ? (
        <CourseGrades courseId={courseId} currentUser={auth.currentUser?.email} />
      ) : (
        <>
          <div className="sec-title" style={{ fontSize: 15, marginBottom: 10 }}>Course Content</div>
          {modules.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text3)" }}>No modules published yet.</div>
          ) : (
            modules.map(m => (
              <StudentModuleRow key={m.id} courseId={courseId} module={m} isEnrolled={isEnrolled} onOpenLesson={setActiveLesson} />
            ))
          )}
        </>
      )}
    </div>
  );
}

function StudentModuleRow({ courseId, module: m, isEnrolled, onOpenLesson }) {
  const [open, setOpen] = useState(false);
  const [lessons, setLessons] = useState([]);

  useEffect(() => {
    if (!open) return;
    const unsub = subscribeLessons(courseId, m.id, setLessons);
    return unsub;
  }, [open, courseId, m.id]);

  const typeIcon = { video: "🎬", reading: "📖", live: "🔴" };

  return (
    <div className="card" style={{ marginBottom: 8, padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        {open ? "▼" : "▶"} {m.title}
      </div>
      {open && (
        <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: "2px solid var(--border,#e5e5e5)" }}>
          {lessons.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text3)" }}>No lessons yet.</div>
          ) : lessons.map(l => (
            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 12.5 }}>
              <span>{isEnrolled ? "" : "🔒 "}{typeIcon[l.type] || "📄"} {l.title}</span>
              {isEnrolled ? (
                <button className="btn btn-sm btn-purple" onClick={() => onOpenLesson(l)}>Open</button>
              ) : (
                <span style={{ color: "var(--text3)", fontSize: 11 }}>Enroll to unlock</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LessonPlayer — renders one lesson: video / reading / live.
// ═══════════════════════════════════════════════════════════════════
function LessonPlayer({ lesson, onBack, courseTitle }) {
  const c = lesson.content || {};

  const renderVideo = (url) => {
    if (!url) return <div style={{ color: "var(--text3)" }}>No video URL set.</div>;
    const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{6,})/);
    if (yt) {
      return <iframe title={lesson.title} src={`https://www.youtube.com/embed/${yt[1]}`} style={{ width: "100%", aspectRatio: "16/9", border: "none", borderRadius: 10 }} allowFullScreen />;
    }
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) {
      return <iframe title={lesson.title} src={`https://player.vimeo.com/video/${vm[1]}`} style={{ width: "100%", aspectRatio: "16/9", border: "none", borderRadius: 10 }} allowFullScreen />;
    }
    return <video controls style={{ width: "100%", borderRadius: 10 }} src={url} />;
  };

  return (
    <div>
      <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>← Back to {courseTitle}</button>
      <div className="card">
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>{lesson.title}</div>

        {lesson.type === "video" && renderVideo(c.videoUrl)}

        {lesson.type === "reading" && (
          <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{c.textBody || "No content yet."}</div>
        )}

        {lesson.type === "live" && (
          <div>
            {c.scheduledAt && <div style={{ marginBottom: 10, fontSize: 13, color: "var(--text3)" }}>📅 Scheduled: {new Date(c.scheduledAt).toLocaleString()}</div>}
            {c.liveLink ? (
              <a href={c.liveLink} target="_blank" rel="noopener noreferrer" className="btn btn-purple" style={{ textDecoration: "none", display: "inline-block" }}>🔴 Join Live Session</a>
            ) : (
              <div style={{ color: "var(--text3)" }}>No session link set yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CourseAssignments — reuses the existing classId-scoped assignment
// backend (asgSave/asgSubmit/asgGrade etc.), filtered by courseId
// instead. Same submission/grading logic, just a different scope.
// ═══════════════════════════════════════════════════════════════════
export function CourseAssignments({ courseId, currentUser, isStaff, toast }) {
  const [assignments, setAssignments] = useState([]);
  const [selAsgn, setSelAsgn] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [mySubmission, setMySubmission] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", desc: "", dueAt: "", maxScore: 100 });
  const [uploading, setUploading] = useState(false);
  const [gradingId, setGradingId] = useState(null);
  const [gradeForm, setGradeForm] = useState({ grade: "", feedback: "" });
  const allUsers = ls("nv-users", []);

  useEffect(() => {
    const unsub = asgSubscribeByCourse(courseId, setAssignments);
    return () => unsub();
  }, [courseId]);

  useEffect(() => {
    if (!selAsgn) return;
    if (isStaff) asgLoadSubmissions(selAsgn.id).then(setSubmissions);
    else asgLoadMySubmission(selAsgn.id, currentUser).then(setMySubmission);
  }, [selAsgn?.id, isStaff]);

  const createAsgn = async () => {
    if (!form.title.trim()) return toast("Title required", "error");
    if (!form.dueAt) return toast("Due date required", "error");
    const id = "asgn_" + Date.now();
    const asgn = { id, courseId, title: form.title.trim(), desc: form.desc.trim(), dueAt: new Date(form.dueAt).getTime(), maxScore: +form.maxScore || 100, createdBy: currentUser, createdAt: Date.now() };
    const ok = await asgSave(asgn);
    if (ok) { toast("Assignment posted ✅", "success"); setShowForm(false); setForm({ title: "", desc: "", dueAt: "", maxScore: 100 }); }
    else toast("Failed to post", "error");
  };

  const submitWork = async (asgn) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".pdf,.doc,.docx,.png,.jpg,.txt";
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) return toast("File too large — max 2MB", "error");
      setUploading(true);
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const ok = await asgSubmit(asgn.id, currentUser, ev.target.result, file.name);
        if (ok) { toast("Submitted ✅", "success"); asgLoadMySubmission(asgn.id, currentUser).then(setMySubmission); }
        else toast("Submit failed", "error");
        setUploading(false);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const saveGrade = async () => {
    if (!gradeForm.grade) return toast("Enter a grade", "error");
    const ok = await asgGrade(selAsgn.id, gradingId, +gradeForm.grade, gradeForm.feedback);
    if (ok) { toast("Graded ✅", "success"); asgLoadSubmissions(selAsgn.id).then(setSubmissions); setGradingId(null); }
  };

  const statusOf = (a) => {
    const now = Date.now();
    if (now > a.dueAt) return { label: "Overdue", color: "var(--danger)" };
    if (a.dueAt - now < 86400000) return { label: "Due soon", color: "var(--warn)" };
    return { label: "Open", color: "var(--success)" };
  };

  if (selAsgn) {
    const st = statusOf(selAsgn);
    return (
      <div>
        <button className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => { setSelAsgn(null); setSubmissions([]); setMySubmission(null); }}>← Back to assignments</button>
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{selAsgn.title}</div>
          <div style={{ fontSize: 13, color: "var(--text2)", margin: "8px 0" }}>{selAsgn.desc}</div>
          <div style={{ fontSize: 12, color: st.color, fontWeight: 700 }}>{st.label} — due {new Date(selAsgn.dueAt).toLocaleString()} • Max score {selAsgn.maxScore}</div>
        </div>

        {isStaff ? (
          <div>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Submissions ({submissions.length})</div>
            {submissions.length === 0 && <div style={{ textAlign: "center", padding: 20, color: "var(--text3)" }}>No submissions yet</div>}
            {submissions.map(sub => (
              <div key={sub.student} className="card" style={{ marginBottom: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{allUsers.find(u => u.username === sub.student)?.displayName || sub.student}</div>
                  {sub.grade != null ? <span style={{ fontWeight: 800, color: "var(--success)" }}>{sub.grade}/{selAsgn.maxScore}</span> :
                    <button className="btn btn-sm btn-purple" onClick={() => { setGradingId(sub.student); setGradeForm({ grade: "", feedback: "" }); }}>Grade</button>}
                </div>
                <a href={sub.fileData} download={sub.fileName} style={{ fontSize: 12, color: "var(--accent)" }}>📎 {sub.fileName}</a>
                {gradingId === sub.student && (
                  <div style={{ marginTop: 8 }}>
                    <input className="inp" type="number" placeholder={`Grade (out of ${selAsgn.maxScore})`} value={gradeForm.grade} onChange={e => setGradeForm(f => ({ ...f, grade: e.target.value }))} />
                    <textarea className="inp" placeholder="Feedback (optional)" value={gradeForm.feedback} onChange={e => setGradeForm(f => ({ ...f, feedback: e.target.value }))} />
                    <button className="btn btn-sm btn-purple" onClick={saveGrade}>Save Grade</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="card">
            {mySubmission ? (
              <div>
                <div style={{ fontSize: 13 }}>✅ Submitted: <a href={mySubmission.fileData} download={mySubmission.fileName}>{mySubmission.fileName}</a></div>
                {mySubmission.grade != null && <div style={{ marginTop: 8, fontWeight: 800, color: "var(--success)" }}>Grade: {mySubmission.grade}/{selAsgn.maxScore}</div>}
                {mySubmission.feedback && <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 4 }}>💬 {mySubmission.feedback}</div>}
              </div>
            ) : (
              <button className="btn btn-purple" onClick={() => submitWork(selAsgn)} disabled={uploading}>{uploading ? "Uploading…" : "📎 Submit Work"}</button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {isStaff && (
        <div style={{ marginBottom: 12 }}>
          {!showForm ? <button className="btn btn-sm btn-purple" onClick={() => setShowForm(true)}>+ New Assignment</button> : (
            <div className="card">
              <input className="inp" placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              <textarea className="inp" placeholder="Description" value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} />
              <input className="inp" type="datetime-local" value={form.dueAt} onChange={e => setForm(f => ({ ...f, dueAt: e.target.value }))} />
              <input className="inp" type="number" placeholder="Max score" value={form.maxScore} onChange={e => setForm(f => ({ ...f, maxScore: e.target.value }))} />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-sm btn-purple" onClick={createAsgn}>Post</button>
                <button className="btn btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {assignments.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--text3)" }}>No assignments posted yet.</div>
      ) : assignments.map(a => {
        const st = statusOf(a);
        return (
          <div key={a.id} className="card" style={{ marginBottom: 8, padding: 12, cursor: "pointer" }} onClick={() => setSelAsgn(a)}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.title}</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text3)" }}>Due {new Date(a.dueAt).toLocaleDateString()}</div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CourseGrades — student's own grade summary for one course, built
// from graded assignment submissions. Computes a simple percentage
// and letter grade. (Quiz results aren't factored in yet — no
// course-scoped quiz system has been built, only the assignment one.)
// ═══════════════════════════════════════════════════════════════════
export function CourseGrades({ courseId, currentUser }) {
  const [rows, setRows] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    const unsub = asgSubscribeByCourse(courseId, async (assignments) => {
      const withGrades = await Promise.all(assignments.map(async a => {
        const sub = await asgLoadMySubmission(a.id, currentUser).catch(() => null);
        return { ...a, grade: sub?.grade ?? null, feedback: sub?.feedback || "" };
      }));
      if (!cancelled) setRows(withGrades);
    });
    return () => { cancelled = true; unsub(); };
  }, [courseId, currentUser]);

  if (rows === null) return <div className="card">Loading grades…</div>;

  const graded = rows.filter(r => r.grade != null);
  const totalEarned = graded.reduce((s, r) => s + Number(r.grade), 0);
  const totalPossible = graded.reduce((s, r) => s + Number(r.maxScore || 100), 0);
  const pct = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;

  const letterFor = (p) => {
    if (p == null) return "—";
    if (p >= 70) return "A";
    if (p >= 60) return "B";
    if (p >= 50) return "C";
    if (p >= 45) return "D";
    return "F";
  };
  const gpaFor = (p) => {
    if (p == null) return "—";
    if (p >= 70) return "5.0";
    if (p >= 60) return "4.0";
    if (p >= 50) return "3.0";
    if (p >= 45) return "2.0";
    return "1.0";
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 14, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".05em" }}>Course Average</div>
        <div style={{ fontSize: 32, fontWeight: 800, margin: "4px 0" }}>{pct != null ? `${pct.toFixed(1)}%` : "—"}</div>
        <div style={{ fontSize: 13, color: "var(--text2)" }}>Grade: <b>{letterFor(pct)}</b> • GPA points: <b>{gpaFor(pct)}</b></div>
        {graded.length < rows.length && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>{rows.length - graded.length} assignment(s) not yet graded — excluded from average</div>}
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--text3)" }}>No assignments in this course yet.</div>
      ) : rows.map(r => (
        <div key={r.id} className="card" style={{ marginBottom: 6, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{r.title}</div>
            {r.feedback && <div style={{ fontSize: 11.5, color: "var(--text3)" }}>💬 {r.feedback}</div>}
          </div>
          <div style={{ fontWeight: 800, color: r.grade != null ? "var(--success)" : "var(--text3)" }}>
            {r.grade != null ? `${r.grade}/${r.maxScore}` : "Ungraded"}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 10, textAlign: "center" }}>
        GPA scale shown is illustrative (5.0 max, NUC-style) — adjust letterFor()/gpaFor() in CourseGrades to match your institution's actual scale.
      </div>
    </div>
  );
}
