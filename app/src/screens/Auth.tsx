// Sign in + Sign up — split layout with a generative world-map pulse.

import { useState } from "react";
import { LhqLogo } from "../components/Shell";
import { Btn, Input } from "../components/Primitives";
import { IconChevR } from "../lib/icons";
import { useApp } from "../state";

function AuthArt() {
  const cols = 22,
    rows = 28;
  const nodes = [
    { c: 4, r: 6 },
    { c: 12, r: 9 },
    { c: 17, r: 14 },
    { c: 7, r: 18 },
    { c: 15, r: 22 },
  ];

  const dots: JSX.Element[] = [];
  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      const cx = ((ci + 0.5) / cols) * 100;
      const cy = ((ri + 0.5) / rows) * 100;
      const distMin = Math.min(
        ...nodes.map((n) => Math.hypot(ci - n.c, ri - n.r))
      );
      const op = Math.max(0.05, 0.35 - distMin * 0.04);
      dots.push(<circle key={`${ri}-${ci}`} cx={`${cx}%`} cy={`${cy}%`} r="1.1" fill="#14110D" opacity={op} />);
    }
  }

  return (
    <div className="lhq-auth-art">
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        {dots}
        {nodes.slice(0, -1).map((n, i) => {
          const m = nodes[i + 1];
          const x1 = ((n.c + 0.5) / cols) * 100,
            y1 = ((n.r + 0.5) / rows) * 100;
          const x2 = ((m.c + 0.5) / cols) * 100,
            y2 = ((m.r + 0.5) / rows) * 100;
          const mx = (x1 + x2) / 2,
            my = Math.min(y1, y2) - 5;
          return (
            <path
              key={i}
              d={`M${x1}%,${y1}% Q${mx}%,${my}% ${x2}%,${y2}%`}
              stroke="var(--accent-ink)"
              strokeOpacity="0.18"
              strokeDasharray="2 4"
              fill="none"
            />
          );
        })}
        {nodes.map((n, i) => {
          const cx = ((n.c + 0.5) / cols) * 100,
            cy = ((n.r + 0.5) / rows) * 100;
          return (
            <g key={i}>
              <circle cx={`${cx}%`} cy={`${cy}%`} r="4" fill="var(--accent)" />
              <circle cx={`${cx}%`} cy={`${cy}%`} r="4" fill="none" stroke="var(--accent)" strokeOpacity="0.3">
                <animate attributeName="r" values="4;12;4" dur={`${2 + i * 0.4}s`} repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.3;0;0.3" dur={`${2 + i * 0.4}s`} repeatCount="indefinite" />
              </circle>
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", top: 40, left: 40 }}>
        <LhqLogo size={24} />
      </div>
      <div style={{ position: "absolute", bottom: 40, left: 40, right: 40 }}>
        <div className="serif-it" style={{ fontSize: 34, lineHeight: 1.1, color: "var(--ink)", maxWidth: 360 }}>
          The calm between you<br />and your servers.
        </div>
        <div style={{ marginTop: 18, fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>
          local-first · zero servers harvested · runs in your terminal
        </div>
      </div>
    </div>
  );
}

export function SignInScreen() {
  const { signIn, navigate } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    signIn(email || "local@lockethq");
  };

  return (
    <div className="lhq-app">
      <div style={{ flex: 1, position: "relative" }}>
        <AuthArt />
      </div>
      <form
        onSubmit={submit}
        style={{
          width: 460,
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "64px 56px",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted-2)",
              fontFamily: "var(--mono)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Welcome back
          </div>
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 38,
              margin: 0,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
            }}
          >
            Sign in to DockPilot
          </h2>
          <p style={{ marginTop: 12, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.55 }}>
            Manage your fleet from one quiet console.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 36 }}>
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="june@evergreen.co" />
            <div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="lhq-label">Password</span>
                <a style={{ fontSize: 11.5, color: "var(--accent-ink)" }}>Forgot?</a>
              </div>
              <input
                className="lhq-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Btn variant="primary" size="lg" style={{ marginTop: 8, width: "100%" }} type="submit">
              Sign in
            </Btn>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
          New to DockPilot?{" "}
          <a
            style={{ color: "var(--accent-ink)", textDecoration: "underline", cursor: "default" }}
            onClick={() => navigate({ kind: "auth", mode: "signup" })}
          >
            Create an account
          </a>
        </div>
      </form>
    </div>
  );
}

export function SignUpScreen() {
  const { signIn, navigate } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  return (
    <div className="lhq-app">
      <div style={{ flex: 1, position: "relative" }}>
        <AuthArt />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signIn(email);
        }}
        style={{
          width: 460,
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "64px 56px",
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted-2)",
              fontFamily: "var(--mono)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Get started · local profile
          </div>
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 38,
              margin: 0,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
            }}
          >
            Create your<br />workspace
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 32 }}>
            <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} placeholder="June Park" />
            <Input
              label="Work email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="june@evergreen.co"
            />
            <Input label="Workspace" prefix="lockethq.local/" placeholder="evergreen" />
            <Btn variant="primary" size="lg" style={{ marginTop: 8, width: "100%" }} iconRight={IconChevR} type="submit">
              Create workspace
            </Btn>
            <div style={{ fontSize: 11, color: "var(--muted-2)", lineHeight: 1.5, marginTop: 4 }}>
              The profile lives on this Mac. SSH keys + runner tokens stay in your local app data folder.
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
          Already have an account?{" "}
          <a
            style={{ color: "var(--accent-ink)", textDecoration: "underline", cursor: "default" }}
            onClick={() => navigate({ kind: "auth", mode: "signin" })}
          >
            Sign in
          </a>
        </div>
      </form>
    </div>
  );
}
