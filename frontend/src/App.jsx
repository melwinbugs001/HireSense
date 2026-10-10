import { useCallback, useEffect, useRef, useState } from "react";

const API_ERROR = "Could not reach the API. Make sure FastAPI is running on port 8000.";
const GENERIC_ROLE_NAMES = new Set([
  "bar", "example", "foo", "job", "null", "role", "sample", "string", "test", "title", "undefined",
]);

async function api(path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new Error(API_ERROR);
  }
  if (response.status === 401 && token) throw new Error("Your session expired. Please sign in again.");
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(typeof payload === "object" ? payload.detail || "Request failed." : payload);
  }
  return payload;
}

function BrandMark() {
  return <span className="brand-mark"><span /><span /><span /></span>;
}

function Brand({ mobile = false }) {
  return (
    <span className={mobile ? "mobile-brand" : "brand"}>
      <BrandMark /> <span className="brand-name">Hire<span>Sense</span></span>
    </span>
  );
}

function Message({ speaker, text, feedback }) {
  const candidate = speaker === "candidate";
  return (
    <article className={`message ${speaker}`}>
      <span className="message-label">{candidate ? "YOU" : "YOUR INTERVIEWER"}</span>
      <div className="message-bubble">{text}</div>
      {feedback && <span className="message-feedback">✳ &nbsp;{feedback}</span>}
    </article>
  );
}

function speakWithBrowser(text, notify) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    notify("The question is ready. Browser speech isn’t available, so please read it on screen.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onerror = () => notify("The question is ready. Please read it on screen.");
  window.speechSynthesis.speak(utterance);
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("practice_room_token"));
  const [user, setUser] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [screen, setScreen] = useState("auth");
  const [registering, setRegistering] = useState(false);
  const [authError, setAuthError] = useState("");
  const [createError, setCreateError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [currentInterview, setCurrentInterview] = useState(null);
  const [turns, setTurns] = useState([]);
  const [answerCount, setAnswerCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [isDictating, setIsDictating] = useState(false);
  const socketRef = useRef(null);
  const recognitionRef = useRef(null);
  const answerRef = useRef(null);
  const toastTimeoutRef = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(""), 3200);
  }, []);

  const refreshDashboard = useCallback(async (authToken = token) => {
    const [account, sessions] = await Promise.all([
      api("/auth/me", authToken),
      api("/interviews", authToken),
    ]);
    setUser(account);
    setInterviews(sessions);
    setScreen("dashboard");
  }, [token]);

  useEffect(() => {
    if (!token) {
      setScreen("auth");
      return undefined;
    }
    let cancelled = false;
    Promise.all([api("/auth/me", token), api("/interviews", token)])
      .then(([account, sessions]) => {
        if (cancelled) return;
        setUser(account);
        setInterviews(sessions);
        setScreen("dashboard");
      })
      .catch((error) => {
        if (cancelled) return;
        localStorage.removeItem("practice_room_token");
        setToken(null);
        setAuthError(error.message);
        setScreen("auth");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => () => {
    socketRef.current?.close();
    recognitionRef.current?.stop();
    window.clearTimeout(toastTimeoutRef.current);
  }, []);

  const signOut = () => {
    socketRef.current?.close();
    socketRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    localStorage.removeItem("practice_room_token");
    setToken(null);
    setUser(null);
    setCurrentInterview(null);
    setAuthError("");
    setScreen("auth");
    notify("You’ve signed out.");
  };

  const connectSocket = (interview) => {
    socketRef.current?.close();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws/interviews/${interview.id}?token=${encodeURIComponent(token)}`,
    );
    socketRef.current = socket;
    socket.onopen = () => setLiveError("");
    socket.onmessage = async (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        setLiveError("The interviewer sent a message we couldn’t read.");
        return;
      }
      if (message.type === "question") {
        setTurns((previous) => {
          const last = previous.at(-1);
          return last?.speaker === "interviewer" && last.text === message.text
            ? previous
            : [...previous, { speaker: "interviewer", text: message.text }];
        });
      } else if (message.type === "evaluation") {
        setTurns((previous) => [
          ...previous,
          {
            speaker: "candidate",
            text: message.transcript,
            feedback: `${message.score}/10 · ${message.feedback}`,
          },
          { speaker: "interviewer", text: message.next_question },
        ]);
        setAnswerCount((count) => count + 1);
        setBusy(false);
        if (answerRef.current) answerRef.current.value = "";
        answerRef.current?.focus();
      } else if (message.type === "audio") {
        try {
          await new Audio(`data:${message.content_type};base64,${message.audio_base64}`).play();
        } catch {
          speakWithBrowser(message.text, notify);
        }
      } else if (message.type === "audio_unavailable") {
        speakWithBrowser(message.text, notify);
      } else if (message.type === "error") {
        setLiveError(message.detail || "Something went wrong. Please try again.");
        setBusy(false);
      }
    };
    socket.onerror = () => setLiveError(API_ERROR);
    socket.onclose = (event) => {
      if (socketRef.current !== socket || event.code === 1000) return;
      setLiveError(event.reason || "The live connection closed. Return to your interviews and try again.");
      setBusy(false);
    };
  };

  const openInterview = async (interview) => {
    try {
      let session = interview;
      if (session.status === "scheduled") {
        session = await api(`/interviews/${session.id}/start`, token, { method: "POST" });
      } else if (session.status === "completed") {
        notify("This practice session is complete. Start a new one to keep practicing.");
        return;
      }
      setCurrentInterview(session);
      setTurns([]);
      setAnswerCount(0);
      setBusy(false);
      setLiveError("");
      setScreen("live");
      const transcript = await api(`/interviews/${session.id}/transcript`, token);
      setTurns(transcript.turns.map((turn) => ({
        speaker: turn.speaker,
        text: turn.content,
        feedback: turn.feedback?.text
          ? `${turn.score}/10 · ${turn.feedback.text}`
          : undefined,
      })));
      setAnswerCount(transcript.turns.filter((turn) => turn.speaker === "candidate").length);
      connectSocket(session);
    } catch (error) {
      notify(error.message);
    }
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      email: form.get("email").trim(),
      password: form.get("password"),
    };
    try {
      if (registering) {
        payload.full_name = form.get("full_name").trim();
        await api("/auth/register", null, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      const result = await api("/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email: payload.email, password: payload.password }),
      });
      localStorage.setItem("practice_room_token", result.access_token);
      setToken(result.access_token);
      setRegistering(false);
      event.currentTarget.reset();
      await refreshDashboard(result.access_token);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const createInterview = async (event) => {
    event.preventDefault();
    setCreateError("");
    const form = new FormData(event.currentTarget);
    const role = form.get("role").trim().replace(/\s+/g, " ");
    if (Array.from(role).length < 2 || !/[\p{L}\p{N}]/u.test(role)) {
      setCreateError("Enter a role with at least two characters and a letter or number.");
      return;
    }
    if (GENERIC_ROLE_NAMES.has(role.toLocaleLowerCase())) {
      setCreateError("Enter a specific job role, such as Python Developer.");
      return;
    }
    try {
      const interview = await api("/interviews", token, {
        method: "POST",
        body: JSON.stringify({
          role,
          level: form.get("level"),
        }),
      });
      setInterviews((previous) => [interview, ...previous]);
      event.currentTarget.reset();
      await openInterview(interview);
    } catch (error) {
      setCreateError(error.message);
    }
  };

  const deleteInterview = async (interview) => {
    if (interview.status === "active") {
      notify("End this active session before deleting it.");
      return;
    }
    if (!window.confirm(`Delete the "${interview.role}" session? Its transcript and results will also be deleted.`)) {
      return;
    }
    try {
      await api(`/interviews/${interview.id}`, token, { method: "DELETE" });
      setInterviews((previous) => previous.filter((item) => item.id !== interview.id));
      notify("Session and its transcript deleted.");
    } catch (error) {
      notify(error.message);
    }
  };

  const finishInterview = async () => {
    if (!currentInterview || busy) return;
    socketRef.current?.close(1000);
    socketRef.current = null;
    try {
      await api(`/interviews/${currentInterview.id}/end`, token, { method: "POST" });
      await refreshDashboard();
      setCurrentInterview(null);
      notify("Session saved. Nice work showing up.");
    } catch (error) {
      setLiveError(error.message);
    }
  };

  const sendAnswer = (event) => {
    event.preventDefault();
    const text = answerRef.current?.value.trim();
    if (!text || busy) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setLiveError("The interviewer isn’t connected yet. Please wait or return to your interviews.");
      return;
    }
    socketRef.current.send(JSON.stringify({ type: "answer", text }));
    setBusy(true);
    setLiveError("");
  };

  const dictateAnswer = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      notify("Voice dictation isn’t available in this browser. Please type your answer.");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;
    setIsDictating(true);
    recognition.onresult = (event) => {
      let text = "";
      for (let index = 0; index < event.results.length; index += 1) {
        text += `${event.results[index][0].transcript} `;
      }
      if (answerRef.current) answerRef.current.value = text.trim();
    };
    recognition.onerror = (event) => {
      if (!["no-speech", "aborted"].includes(event.error)) {
        setLiveError("Microphone dictation failed. Check browser microphone permission.");
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsDictating(false);
      answerRef.current?.focus();
    };
    recognition.start();
  };

  const sortedInterviews = [...interviews].sort(
    (first, second) => new Date(second.created_at) - new Date(first.created_at),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="HireSense home"><Brand /></a>
        <div className="sidebar-label">WORKSPACE</div>
        <button className={`nav-link ${screen === "dashboard" ? "active" : ""}`} onClick={() => {
          if (screen === "live") finishInterview();
          else setScreen("dashboard");
        }}><span className="nav-icon">⌂</span> My interviews</button>
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-spark">✳</div>
            <strong>Make your next<br />move with confidence.</strong>
            <span>Thoughtful practice for what’s next.</span>
          </div>
          {user && <div className="user-menu">
            <div className="avatar">{user.full_name.trim().charAt(0) || "?"}</div>
            <div className="user-meta"><strong>{user.full_name}</strong><span>{user.email}</span></div>
            <button className="icon-button logout-button" onClick={signOut} title="Sign out" aria-label="Sign out">↗</button>
          </div>}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{screen === "live" ? "Practice session" : screen === "auth" ? "Welcome" : "My interviews"}</strong></div>
          <div className="topbar-right"><span className="status-dot" /><span>AI interviewer ready</span></div>
        </header>

        {screen === "auth" && <section className="auth-screen">
          <div className="auth-art">
            <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
            <div className="art-center"><span className="art-star">✳</span><span>YOUR NEXT<br />CHAPTER STARTS HERE</span></div>
            <div className="art-note note-top"><span>✦</span> Find your confidence</div>
            <div className="art-note note-bottom">A better answer starts with practice <span>↗</span></div>
          </div>
          <div className="auth-panel">
            <Brand mobile />
            <div className="eyebrow"><span className="eyebrow-line" /> A SMARTER WAY TO SHOW UP</div>
            <h1>{registering ? <>Your next<br />chapter <em>starts.</em></> : <>Make your<br />next move <em>count.</em></>}</h1>
            <p className="auth-copy">{registering
              ? "Create your private practice space. Your first interview is just a few steps away."
              : "A little practice can change everything. Sign in and let’s get you ready."}</p>
            <form onSubmit={submitAuth}>
              {registering && <div className="field">
                <label htmlFor="full-name">Your name</label>
                <input id="full-name" name="full_name" autoComplete="name" placeholder="Jordan Lee" required minLength={1} maxLength={160} />
              </div>}
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={8} maxLength={128} placeholder="At least 8 characters" required />
              </div>
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="button button-primary auth-submit" type="submit">{registering ? "Create my account" : "Sign in"} <span>→</span></button>
            </form>
            <p className="auth-switch"><span>{registering ? "Already have an account?" : "New around here?"}</span>{" "}
              <button type="button" onClick={() => { setRegistering(!registering); setAuthError(""); }}>
                {registering ? "Sign in" : "Create an account"}
              </button>
            </p>
            <p className="auth-footnote"><span>✳</span> Private practice. Real confidence.</p>
          </div>
        </section>}

        {screen === "dashboard" && <section className="dashboard">
          <div className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-line" /> YOUR HIRING EDGE STARTS HERE</div><h1>Ready when<br />you <em>are.</em></h1></div>
            <p>There’s no perfect answer.<br />Just the next one you practice.</p>
          </div>
          <section className="start-card">
            <div className="start-card-copy">
              <div className="start-kicker"><span className="tiny-star">✳</span> THE NEXT STEP</div>
              <h2>Turn practice<br />into <em>progress.</em></h2>
              <p>Pick a role. We’ll build a session around you.</p>
              <form className="create-form" onSubmit={createInterview}>
                <label className="sr-only" htmlFor="role">Interview role</label>
                <input id="role" name="role" minLength={2} maxLength={160} title="Enter a specific role with at least two characters." placeholder="e.g. Product Designer" required />
                <label className="sr-only" htmlFor="level">Experience level</label>
                <select id="level" name="level" defaultValue="mid">
                  <option value="junior">Junior</option><option value="mid">Mid-level</option><option value="senior">Senior</option>
                </select>
                <button className="button button-dark" type="submit">Start practicing <span>↗</span></button>
              </form>
              {createError && <p className="form-error" role="alert">{createError}</p>}
            </div>
            <div className="start-art" aria-hidden="true"><div className="start-sun">✳</div><div className="start-art-word">YOUR<br />NEXT<br />LEVEL.</div><div className="start-art-ring" /><span className="start-art-caption">PRACTICE WITH PURPOSE</span></div>
          </section>
          <div className="list-heading">
            <div><span className="eyebrow">YOUR SESSIONS</span><h2>Progress, in practice.</h2></div>
            <span className="session-count">{interviews.length} {interviews.length === 1 ? "session" : "sessions"}</span>
          </div>
          <div className="interview-list">
            {sortedInterviews.map((interview) => <article className="interview-item" key={interview.id}>
              <div className="item-icon" aria-hidden="true">✳</div>
              <div className="item-info"><strong>{interview.role}</strong><span>Session #{interview.id} · {interview.level} level · {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(interview.created_at))}</span></div>
              <span className={`item-status ${interview.status === "active" ? "active" : ""}`}>{interview.status}</span>
              <button className="item-action" type="button" onClick={() => openInterview(interview)} aria-label={`Open ${interview.role} interview`}>→</button>
              <button className="item-delete" type="button" disabled={interview.status === "active"} onClick={() => deleteInterview(interview)} aria-label={`Delete ${interview.role} session`} title={interview.status === "active" ? "End the session before deleting" : "Delete session"}>×</button>
            </article>)}
          </div>
          {interviews.length === 0 && <div className="empty-state"><span>✳</span><strong>Your story starts here.</strong><p>Start a practice session and take the first step.</p></div>}
        </section>}

        {screen === "live" && currentInterview && <section className="live-screen">
          <div className="live-heading">
            <button className="back-button" onClick={finishInterview}>← &nbsp;All interviews</button>
            <div className="live-role"><span className="live-role-dot" /><span>{currentInterview.role}</span><span className="level-pill">{currentInterview.level}</span></div>
            <button className="button button-end" onClick={finishInterview}>Finish session <span>×</span></button>
          </div>
          <div className="live-layout">
            <section className="conversation-card">
              <div className="conversation-top"><div><span className="eyebrow">YOUR PRACTICE SESSION</span><h1>Take your <em>time.</em></h1></div><div className="live-indicator"><span /> LIVE SESSION</div></div>
              <div className="conversation-feed" aria-live="polite">
                {turns.map((turn, index) => <Message key={`${index}-${turn.speaker}`} {...turn} />)}
              </div>
              <div className="answer-area">
                <form onSubmit={sendAnswer}>
                  <label className="sr-only" htmlFor="answer-input">Your answer</label>
                  <textarea id="answer-input" ref={answerRef} rows="2" maxLength={12000} placeholder="Take a breath. Type your answer here..." required disabled={busy} />
                  <div className="answer-tools"><span>Be yourself. This is a space to practice.</span><div className="answer-actions">
                    <button className={`button button-voice ${isDictating ? "recording" : ""}`} type="button" onClick={dictateAnswer} title="Dictate an answer">◉ <span>{isDictating ? "Stop" : "Speak"}</span></button>
                    <button className="button button-send" type="submit" disabled={busy}>{busy ? "Thinking…" : <>Send answer <span>↑</span></>}</button>
                  </div></div>
                </form>
                {liveError && <p className="form-error" role="alert">{liveError}</p>}
              </div>
            </section>
            <aside className="session-side">
              <div className="coach-card"><span className="coach-icon">✳</span><span className="eyebrow">A NOTE FROM YOUR COACH</span><h3>You don’t have to get it perfect.</h3><p>Take a breath, gather your thoughts, and answer like you’re talking to a real person. You’ve got this.</p><div className="coach-line" /><span className="coach-signoff">ONE QUESTION AT A TIME.</span></div>
              <div className="progress-card"><div className="progress-label"><span>YOUR PROGRESS</span><span>{answerCount} {answerCount === 1 ? "answer" : "answers"}</span></div><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(100, answerCount * 12)}%` }} /></div><span className="progress-note">Every answer is a step forward.</span></div>
            </aside>
          </div>
        </section>}
      </main>
      <div className={`toast ${toast ? "show" : ""}`} role="status">{toast}</div>
    </div>
  );
}

export default App;
