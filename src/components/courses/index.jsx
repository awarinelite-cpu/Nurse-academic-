import { useState, useEffect } from "react";
import {
  createCourse, updateCourse, deleteCourse, listCourses, listLecturers,
  createModule, updateModule, deleteModule, subscribeModules,
  createLesson, updateLesson, deleteLesson, subscribeLessons,
} from "../../services/courses";

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
                  <button className="btn btn-sm" onClick={() => startEdit(c)}>✏️ Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => del(c)}>🗑️</button>
                </div>
              </div>
              {openCourse === c.id && <ModuleManager courseId={c.id} toast={toast} />}
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
