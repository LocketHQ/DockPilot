// New-container wizard.
// 5 steps: Source → Configure → Network & ports → Volumes & env → Review.
// Configure is source-specific (image / github / upload / compose) and
// has a contextual right-side panel.

import {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LhqTopbar } from "../components/Shell";
import { Btn, Input, Tag } from "../components/Primitives";
import { DeployLogsModal, type DeployLogLine } from "../components/DeployLogs";
import {
  IconCheck,
  IconChevL,
  IconChevR,
  IconCompose,
  IconDocker,
  IconGithub,
  IconPlus,
  IconUpload,
  IconX,
} from "../lib/icons";
import { useApp } from "../state";
import type {
  ContainerSource,
  CreateContainerRequest,
  EnvVar,
  Mount,
  PortMapping,
} from "../lib/types";
import * as api from "../lib/api";

type Source = "image" | "github" | "upload" | "compose";

const STEPS: { id: string; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "configure", label: "Configure" },
  { id: "network", label: "Network & ports" },
  { id: "volumes", label: "Volumes & env" },
  { id: "review", label: "Review" },
];
const TOTAL = STEPS.length;

export function WizardScreen({ step: initialStep = 0 }: { step?: number }) {
  const { servers, navigate, showToast } = useApp();
  const [step, setStep] = useState(initialStep);
  const [serverId, setServerId] = useState<string>(servers[0]?.id || "");
  const [source, setSource] = useState<Source>("image");
  const [name, setName] = useState("");

  // image
  const [image, setImage] = useState("nginx:alpine");
  // github
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [commit, setCommit] = useState<string | null>(null); // when set, build this sha instead of branch HEAD
  const [workingDir, setWorkingDir] = useState("./");
  const [dockerfile, setDockerfile] = useState("Dockerfile");
  const [autoDeploy, setAutoDeploy] = useState(false);
  // upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // compose
  const [composeYaml, setComposeYaml] = useState(SAMPLE_COMPOSE);
  const [composeEnv, setComposeEnv] = useState<Record<string, string>>({});

  // shared
  const [env, setEnv] = useState<EnvVar[]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [ports, setPorts] = useState<PortMapping[]>([
    { container_port: 80, host_port: 8080, protocol: "tcp", public: true },
  ]);
  const [network, setNetwork] = useState<string>("bridge");
  const [restart, setRestart] = useState<
    "no" | "always" | "unless-stopped" | "on-failure"
  >("unless-stopped");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Deploy logs (compose streaming)
  const [logsOpen, setLogsOpen] = useState(false);
  const [logLines, setLogLines] = useState<DeployLogLine[]>([]);
  const [deployStatus, setDeployStatus] = useState<"running" | "done" | "error">("running");
  const [deployIds, setDeployIds] = useState<string[]>([]);
  const [deployError, setDeployError] = useState<string | null>(null);
  const deployCancelRef = useRef<null | (() => Promise<void>)>(null);

  // For compose, steps 3+4 collapse into compose's view; show all 5 anyway
  // but configure-step content is the YAML, and 3/4 say "compose handles this".

  function buildSource(): ContainerSource {
    switch (source) {
      case "image": return { type: "image", image };
      case "github":
        return {
          // Docker build accepts a sha at the #ref position, so we just send
          // the chosen ref (commit if set, else branch) in the branch field.
          type: "github",
          repo,
          branch: commit || branch,
          dockerfile_path: joinPath(workingDir, dockerfile),
        };
      case "upload":
        return {
          type: "upload",
          archive_path: uploadFile?.name || "",
          dockerfile_path: dockerfile,
        };
      case "compose":
        return { type: "compose", yaml: composeYaml };
    }
  }

  function defaultName(): string {
    if (source === "image") return image.split(":")[0].split("/").pop() || "container";
    if (source === "github") return repo.split("/").pop() || "github-build";
    if (source === "upload")
      return (uploadFile?.name || "upload").replace(/\.(tar\.gz|tgz|zip)$/i, "");
    return "compose-stack";
  }

  async function readFileAsBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function submit() {
    if (!serverId) { setErr("Pick a server first."); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const finalName = name || defaultName();
      if (source === "compose") {
        setLogLines([]);
        setDeployStatus("running");
        setDeployIds([]);
        setDeployError(null);
        setLogsOpen(true);
        try {
          const { cancel } = await api.streamComposeUp(
            serverId,
            finalName,
            composeYaml,
            composeEnv,
            (payload) => {
              const line = payload as DeployLogLine;
              setLogLines((prev) => [...prev, line]);
              if (line.event === "done") {
                setDeployIds(line.ids);
                setDeployStatus("done");
              } else if (line.event === "error") {
                setDeployError(line.message);
                setDeployStatus("error");
              }
            },
            (msg) => {
              setDeployError(msg);
              setDeployStatus("error");
            }
          );
          deployCancelRef.current = cancel;
        } catch (e: any) {
          setDeployError(String(e));
          setDeployStatus("error");
        }
        // We return here — the modal owns the rest of the flow.
        return;
      }
      const req: CreateContainerRequest = {
        name: finalName,
        source: buildSource(),
        env,
        ports,
        mounts,
        restart_policy: restart,
        command: null,
        network: network === "bridge" ? null : network,
        resources: null,
      };
      if (source === "upload") {
        if (!uploadFile) { setErr("Pick a folder/.zip"); setSubmitting(false); return; }
        const b64 = await readFileAsBase64(uploadFile);
        const res = await api.createContainerFromUpload(serverId, req, b64);
        showToast("container built + started");
        navigate({ kind: "container", serverId, containerId: res.id });
        return;
      }
      const res = await api.createContainer(serverId, req);
      showToast("container created");
      navigate({ kind: "container", serverId, containerId: res.id });
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setUploadFile(f);
  }

  function canContinue(): boolean {
    if (step === 0) return !!serverId;
    if (step === 1) {
      if (source === "image") return !!image.trim();
      if (source === "github") return !!repo.trim();
      if (source === "upload") return !!uploadFile;
      if (source === "compose") return !!composeYaml.trim();
    }
    if (step === 3 && source === "compose") {
      const refs = parseComposeEnvRefs(composeYaml);
      for (const r of refs) {
        if (r.required && !r.defaultValue && !(composeEnv[r.name] || "").trim()) {
          return false;
        }
      }
    }
    return true;
  }

  // ⌘K / number shortcuts on the Source step
  useEffect(() => {
    if (step !== 0) return;
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Source> = { "1": "image", "2": "github", "3": "upload", "4": "compose" };
      if (map[e.key]) setSource(map[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const stepKicker = useMemo(() => {
    const part = STEPS[step].label.toUpperCase();
    if (step === 1) return `STEP ${step + 1} OF ${TOTAL} · ${part} · ${source.toUpperCase()}`;
    return `STEP ${step + 1} OF ${TOTAL} · ${part}`;
  }, [step, source]);

  return (
    <div className="lhq-main">
      <LhqTopbar
        breadcrumb={["Containers", "New container"]}
        actions={
          <Btn icon={IconX} variant="ghost" onClick={() => navigate({ kind: "containers" })}>
            Cancel
          </Btn>
        }
      />
      <div className="lhq-content" style={{ padding: 0, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <WizardRail step={step} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          <div style={{ flex: 1, padding: "32px 40px", overflow: "auto" }}>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                color: "var(--muted-2)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              {stepKicker}
            </div>
            <h1
              style={{
                fontFamily: "var(--sans)",
                fontSize: 32,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: 0,
                color: "var(--ink)",
              }}
            >
              {titleFor(step, source)}
            </h1>

            <div style={{ marginTop: 28 }}>
              {step === 0 && (
                <SourceStep
                  source={source}
                  setSource={setSource}
                  servers={servers}
                  serverId={serverId}
                  setServerId={setServerId}
                />
              )}
              {step === 1 && (
                <ConfigureStep
                  source={source}
                  name={name}
                  setName={setName}
                  defaultName={defaultName}
                  image={image}
                  setImage={setImage}
                  repo={repo}
                  setRepo={setRepo}
                  branch={branch}
                  setBranch={setBranch}
                  workingDir={workingDir}
                  setWorkingDir={setWorkingDir}
                  dockerfile={dockerfile}
                  setDockerfile={setDockerfile}
                  autoDeploy={autoDeploy}
                  setAutoDeploy={setAutoDeploy}
                  commit={commit}
                  setCommit={setCommit}
                  uploadFile={uploadFile}
                  setUploadFile={setUploadFile}
                  fileRef={fileRef}
                  onPickFile={onPickFile}
                  composeYaml={composeYaml}
                  setComposeYaml={setComposeYaml}
                />
              )}
              {step === 2 && (
                <NetworkStep
                  source={source}
                  ports={ports}
                  setPorts={setPorts}
                  network={network}
                  setNetwork={setNetwork}
                />
              )}
              {step === 3 && (
                <VolumesStep
                  source={source}
                  env={env}
                  setEnv={setEnv}
                  mounts={mounts}
                  setMounts={setMounts}
                  restart={restart}
                  setRestart={setRestart}
                  composeYaml={composeYaml}
                  composeEnv={composeEnv}
                  setComposeEnv={setComposeEnv}
                />
              )}
              {step === 4 && (
                <ReviewStep
                  source={source}
                  name={name}
                  defaultName={defaultName}
                  image={image}
                  repo={repo}
                  branch={branch}
                  workingDir={workingDir}
                  dockerfile={dockerfile}
                  uploadFile={uploadFile}
                  composeYaml={composeYaml}
                  env={env}
                  ports={ports}
                  network={network}
                  restart={restart}
                  servers={servers}
                  serverId={serverId}
                  err={err}
                />
              )}
            </div>
          </div>

          <div
            style={{
              borderTop: "1px solid var(--border)",
              padding: "16px 40px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--surface)",
              flexShrink: 0,
            }}
          >
            {step === 0 ? (
              <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
                Tip: press <span className="kbd">1</span>–<span className="kbd">4</span> to pick a source.
              </span>
            ) : (
              <span style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
                {STEPS[step].label}
              </span>
            )}
            <div style={{ flex: 1 }} />
            <Btn size="lg" icon={IconChevL} onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
              Back
            </Btn>
            {step < TOTAL - 1 ? (
              <Btn
                size="lg"
                variant="primary"
                iconRight={IconChevR}
                onClick={() => setStep(step + 1)}
                disabled={!canContinue()}
              >
                Continue
              </Btn>
            ) : (
              <Btn size="lg" variant="accent" onClick={submit} disabled={submitting}>
                {submitting ? "Deploying…" : source === "compose" ? "Run compose up" : "Deploy container"}
              </Btn>
            )}
          </div>
        </div>
      </div>

      <DeployLogsModal
        open={logsOpen}
        title={`docker compose up · ${name || defaultName()}`}
        lines={logLines}
        status={deployStatus}
        errorMessage={deployError}
        doneHint={deployIds.length ? `${deployIds.length} container${deployIds.length === 1 ? "" : "s"} running` : undefined}
        onClose={async () => {
          if (deployCancelRef.current) {
            await deployCancelRef.current();
            deployCancelRef.current = null;
          }
          setLogsOpen(false);
          if (deployStatus === "done") navigate({ kind: "containers" });
        }}
        onPrimary={
          deployStatus === "done" && deployIds.length > 0
            ? () => {
                setLogsOpen(false);
                navigate({ kind: "container", serverId, containerId: deployIds[0] });
              }
            : undefined
        }
        primaryLabel="Open first container"
      />
    </div>
  );
}

function titleFor(step: number, source: Source): string {
  if (step === 0) return "How would you like to deploy?";
  if (step === 1) {
    if (source === "image") return "Pull from a registry.";
    if (source === "github") return "Choose a repository.";
    if (source === "upload") return "Drop your project here.";
    return "Bring up a stack.";
  }
  if (step === 2) return "Network & ports.";
  if (step === 3) return "Volumes & environment.";
  return "Review & deploy.";
}

// ──────────────────────────────────────────────────────────────────────
// Rail (left)
// ──────────────────────────────────────────────────────────────────────

function WizardRail({ step }: { step: number }) {
  return (
    <div
      className="lhq-rail"
      style={{
        width: 230,
        flexShrink: 0,
        padding: "32px 18px",
        borderRight: "1px solid var(--border)",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: "var(--muted-2)",
          fontFamily: "var(--mono)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 16,
        }}
      >
        New container
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "active" : "todo";
          return (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 4px",
                position: "relative",
              }}
            >
              <RailDot state={state} i={i} />
              <span
                style={{
                  fontSize: 13.5,
                  fontWeight: state === "active" ? 600 : 400,
                  color:
                    state === "active"
                      ? "var(--ink)"
                      : state === "done"
                      ? "var(--muted)"
                      : "var(--muted-2)",
                }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      <div
        className="lhq-card"
        style={{
          padding: 14,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>About this wizard</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.55, fontFamily: "var(--sans)" }}>
          Build, push, and deploy in one go. You can edit any step later.
        </div>
      </div>
    </div>
  );
}

function RailDot({ state, i }: { state: "done" | "active" | "todo"; i: number }) {
  if (state === "done") {
    return (
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "var(--ink)",
          color: "#FAFAF7",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <IconCheck size={12} />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "var(--ink)",
          color: "#FAFAF7",
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {i + 1}
      </div>
    );
  }
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        color: "var(--muted-2)",
        fontFamily: "var(--mono)",
        fontSize: 11,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {i + 1}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 1 — Source
// ──────────────────────────────────────────────────────────────────────

const SOURCE_DEFS: { id: Source; title: string; sub: string; tag: string; icon: any; accent?: boolean }[] = [
  { id: "image", title: "Docker image", sub: "From DockerHub, GHCR, or your own private registry.", tag: "fastest", icon: IconDocker, accent: true },
  { id: "github", title: "GitHub repo", sub: "We build it for you. Detects Dockerfile or Nixpacks.", tag: "auto-build", icon: IconGithub },
  { id: "upload", title: "Upload Dockerfile", sub: "Drop a folder with a Dockerfile; we build & deploy.", tag: "local", icon: IconUpload },
  { id: "compose", title: "docker-compose", sub: "Spin up an entire stack from a single compose file.", tag: "stack", icon: IconCompose },
];

function SourceStep({
  source,
  setSource,
  servers,
  serverId,
  setServerId,
}: {
  source: Source;
  setSource: (s: Source) => void;
  servers: import("../lib/types").ServerRecord[];
  serverId: string;
  setServerId: (id: string) => void;
}) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, maxWidth: 860 }}>
        {SOURCE_DEFS.map((d) => (
          <SourceCard key={d.id} def={d} selected={source === d.id} onClick={() => setSource(d.id)} />
        ))}
      </div>

      {servers.length > 0 && (
        <div style={{ marginTop: 28, maxWidth: 860 }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--mono)",
              color: "var(--muted-2)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Deploy to
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {servers.map((s) => (
              <button
                key={s.id}
                onClick={() => setServerId(s.id)}
                style={{
                  textAlign: "left",
                  background: "var(--surface)",
                  border: "1px solid",
                  borderColor: serverId === s.id ? "var(--ink)" : "var(--border)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: "default",
                  boxShadow: serverId === s.id ? "0 0 0 3px rgba(20,17,13,0.04)" : "none",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted-2)", marginTop: 2 }}>
                  {s.host}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 32,
          fontSize: 12,
          color: "var(--muted)",
          fontFamily: "var(--mono)",
          maxWidth: 860,
        }}
      >
        Pro tip: need a one-liner? Run{" "}
        <span
          className="mono"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          locket deploy --from .
        </span>{" "}
        in your project — we'll handle the rest.
      </div>
    </div>
  );
}

function SourceCard({
  def,
  selected,
  onClick,
}: {
  def: (typeof SOURCE_DEFS)[number];
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = def.icon;
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        textAlign: "left",
        background: "var(--surface)",
        border: "1px solid",
        borderColor: selected ? "var(--ink)" : "var(--border)",
        borderRadius: 14,
        padding: 22,
        cursor: "default",
        boxShadow: selected ? "0 0 0 3px rgba(20,17,13,0.04)" : "none",
        transition: "border-color .12s, box-shadow .12s",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: def.accent ? "var(--accent)" : "var(--surface-2)",
          color: def.accent ? "#0E1F18" : "var(--ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: def.accent ? "none" : "1px solid var(--border)",
        }}
      >
        <Icon size={20} />
      </div>
      <div style={{ marginTop: 16, fontSize: 16, fontWeight: 600, letterSpacing: "-0.005em" }}>{def.title}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)", lineHeight: 1.5, maxWidth: 320 }}>
        {def.sub}
      </div>
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Tag>{def.tag}</Tag>
        {selected ? (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "var(--ink)",
              color: "#FAFAF7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconCheck size={12} />
          </div>
        ) : (
          <IconChevR size={14} color="var(--muted-2)" />
        )}
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 2 — Configure (source-specific)
// ──────────────────────────────────────────────────────────────────────

function ConfigureStep(p: any) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 22, maxWidth: 1200 }}>
      <div style={{ minWidth: 0 }}>
        {p.source === "image" && <ConfigureImage {...p} />}
        {p.source === "github" && <ConfigureGithub {...p} />}
        {p.source === "upload" && <ConfigureUpload {...p} />}
        {p.source === "compose" && <ConfigureCompose {...p} />}
      </div>
      <div>
        {p.source === "image" && <PanelImage image={p.image} />}
        {p.source === "github" && (
          <PanelGithub
            repo={p.repo}
            branch={p.branch}
            commit={p.commit}
            setCommit={p.setCommit}
          />
        )}
        {p.source === "upload" && <PanelUpload file={p.uploadFile} />}
        {p.source === "compose" && <PanelCompose yaml={p.composeYaml} />}
      </div>
    </div>
  );
}

function ConfigureImage(p: any) {
  const [results, setResults] = useState<api.DhSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Pull search-query from the image field (before the colon).
  const queryFromImage = (p.image || "").split(":")[0].trim();

  useEffect(() => {
    if (!queryFromImage) { setResults([]); return; }
    let killed = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.dockerhubSearch(queryFromImage);
        if (killed) return;
        setResults(res.results || []);
      } catch (e) {
        if (!killed) {
          console.warn("dockerhub search failed", e);
          setResults([]);
        }
      } finally {
        if (!killed) setLoading(false);
      }
    }, 250);
    return () => { killed = true; clearTimeout(t); };
  }, [queryFromImage]);

  const selectedImageBase = (p.image || "").split(":")[0];

  function selectResult(r: api.DhSearchResult) {
    const display = r.repo_owner === "library" ? r.repo_name : `${r.repo_owner}/${r.repo_name}`;
    const currentTag = (p.image || "").split(":")[1] || "latest";
    p.setImage(`${display}:${currentTag}`);
  }

  const isOfficial = isLibraryImage(p.image);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label>
        <span className="lhq-label">Image</span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            borderRadius: 8,
            padding: "0 12px",
            height: 42,
            gap: 4,
          }}
        >
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--muted-2)",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            image:
          </span>
          <input
            value={p.image}
            onChange={(e: any) => p.setImage(e.target.value)}
            placeholder="postgres:15.6-alpine"
            style={{
              flex: 1,
              border: 0,
              outline: 0,
              background: "transparent",
              fontFamily: "var(--mono)",
              fontSize: 13,
              color: "var(--ink-2)",
              padding: "0 6px",
            }}
          />
        </div>
      </label>
      <div
        style={{
          fontSize: 12,
          color: "var(--muted)",
          fontFamily: "var(--mono)",
          marginTop: 2,
        }}
      >
        Source: <span style={{ color: "var(--ink-2)" }}>docker.io</span>
        {isOfficial && (
          <>
            <span style={{ color: "var(--muted-2)" }}> · </span>
            <span style={{ color: "var(--accent-ink)" }}>official</span>
          </>
        )}
      </div>

      <Input
        style={{ marginTop: 10 }}
        label="Container name"
        value={p.name}
        onChange={(e: any) => p.setName(e.target.value)}
        placeholder={p.defaultName()}
      />

      <div
        style={{
          marginTop: 16,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Matches in DockerHub</span>
          <div style={{ flex: 1 }} />
          {loading ? (
            <span style={{ fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>searching…</span>
          ) : (
            <Tag tone={results.length > 0 ? "accent" : undefined}>
              {results.length === 0 ? "no results" : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </Tag>
          )}
        </div>
        <div>
          {!queryFromImage && (
            <div style={{ padding: 16, color: "var(--muted-2)", fontSize: 12.5 }}>
              Start typing an image name above to search Docker Hub.
            </div>
          )}
          {queryFromImage && !loading && results.length === 0 && (
            <div style={{ padding: 16, color: "var(--muted)", fontSize: 12.5 }}>
              No matches for <span className="mono">{queryFromImage}</span>.
            </div>
          )}
          {results.map((r, i) => {
            const display = r.repo_owner === "library" ? r.repo_name : `${r.repo_owner}/${r.repo_name}`;
            const isSelected = display === selectedImageBase;
            return (
              <div
                key={display + i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr 90px 80px 100px",
                  gap: 12,
                  padding: "14px 16px",
                  alignItems: "center",
                  background: isSelected ? "var(--accent-tint)" : "transparent",
                  borderBottom: i < results.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <DockerWhale />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}>
                    {display}
                    <span style={{ color: "var(--muted-2)" }}>:{(p.image || "").split(":")[1] || "latest"}</span>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    {r.is_official && <Tag tone="accent">Official</Tag>}
                    {!r.is_official && r.repo_owner && <Tag>{r.repo_owner}</Tag>}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
                  ★ {fmtStars(r.star_count ?? 0)}
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
                  {fmtPulls(r.pull_count)}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {isSelected ? (
                    <Tag tone="accent">Selected</Tag>
                  ) : (
                    <Btn size="sm" onClick={() => selectResult(r)}>
                      Select
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function isLibraryImage(image: string): boolean {
  return !image.includes("/");
}

function fmtStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toString();
}

function DockerWhale() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="3" height="3" rx="0.4" />
        <rect x="7" y="11" width="3" height="3" rx="0.4" />
        <rect x="11" y="11" width="3" height="3" rx="0.4" />
        <rect x="7" y="7" width="3" height="3" rx="0.4" />
        <rect x="11" y="7" width="3" height="3" rx="0.4" />
        <rect x="11" y="3" width="3" height="3" rx="0.4" />
        <path d="M22 13c-.5-1.5-2-2-2-2s.5 1.5 0 2.5" />
        <path d="M2 16c2 2 6 2 9 2 6 0 9-2 11-5" />
      </svg>
    </div>
  );
}

function fmtPulls(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}

function ConfigureGithub(p: any) {
  const connected = p.repo.trim().length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label>
        <span className="lhq-label">Repository</span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            borderRadius: 8,
            padding: "0 12px",
            height: 42,
          }}
        >
          <IconGithub size={15} color="var(--muted)" />
          <input
            value={p.repo}
            onChange={(e: any) => p.setRepo(e.target.value)}
            placeholder="owner/repository"
            style={{
              flex: 1,
              border: 0,
              outline: 0,
              background: "transparent",
              fontFamily: "var(--mono)",
              fontSize: 13,
              color: "var(--ink-2)",
            }}
          />
          {connected && <Tag tone="accent">Connected</Tag>}
        </div>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Input label="Branch" value={p.branch} onChange={(e: any) => p.setBranch(e.target.value)} />
        <label>
          <span className="lhq-label">Auto-deploy on push</span>
          <button
            onClick={() => p.setAutoDeploy(!p.autoDeploy)}
            style={{
              width: "100%",
              height: 38,
              border: "1px solid",
              borderColor: p.autoDeploy ? "var(--ink)" : "var(--border)",
              background: p.autoDeploy ? "var(--ink)" : "var(--surface)",
              color: p.autoDeploy ? "#FAFAF7" : "var(--ink)",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "var(--sans)",
              cursor: "default",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {p.autoDeploy ? <><IconCheck size={13} /> enabled</> : "disabled"}
          </button>
        </label>
      </div>
      <Input
        label="Working directory"
        value={p.workingDir}
        onChange={(e: any) => p.setWorkingDir(e.target.value)}
        placeholder="./"
      />
      <Input
        label="Dockerfile path"
        value={p.dockerfile}
        onChange={(e: any) => p.setDockerfile(e.target.value)}
      />
      <div className="lhq-card" style={{ background: "var(--accent-tint)", borderColor: "color-mix(in oklch, var(--accent) 30%, transparent)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>⚡ Auto-detected</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted)" }}>
            ref: {p.commit ? `${(p.commit as string).slice(0, 7)} (commit)` : `${p.branch} (HEAD)`}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 4, fontWeight: 600 }}>
          Dockerfile · build context: {p.workingDir || "./"}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          We'll clone the repo and run <span className="mono">docker build</span> against{" "}
          <span className="mono">{joinPath(p.workingDir, p.dockerfile)}</span>
          {p.commit ? <> at commit <span className="mono">{(p.commit as string).slice(0, 7)}</span></> : <> on branch <span className="mono">{p.branch}</span></>}.
        </div>
      </div>
    </div>
  );
}

function ConfigureUpload(p: any) {
  const file: File | null = p.uploadFile;
  const sizeMb = file ? (file.size / 1024 / 1024).toFixed(2) : "0";
  const [dragOver, setDragOver] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) p.setUploadFile(f);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input
        ref={p.fileRef}
        type="file"
        accept=".tar,.tar.gz,.tgz,.zip"
        style={{ display: "none" }}
        onChange={p.onPickFile}
      />
      <div
        onClick={() => p.fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: "2px dashed",
          borderColor: dragOver ? "var(--accent)" : "var(--border-strong)",
          borderRadius: 16,
          padding: "44px 24px",
          background: dragOver ? "var(--accent-tint)" : "var(--surface)",
          cursor: "default",
          textAlign: "center",
          minHeight: 340,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          transition: "border-color .12s, background .12s",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <IconUpload size={24} color="var(--ink)" />
        </div>
        <div className="serif-it" style={{ fontSize: 28, color: "var(--ink)" }}>
          {dragOver ? "Drop it here" : "Drop a folder or .zip"}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Or <u>browse for files</u> · max 200 MB
        </div>
      </div>
      {file && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--accent-tint)",
              color: "var(--accent-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconUpload size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, fontFamily: "var(--mono)" }}>{file.name}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)", fontFamily: "var(--mono)", marginTop: 2 }}>
              {sizeMb} MB · loaded
            </div>
          </div>
          <IconCheck size={16} color="var(--accent-ink)" />
          <Btn
            variant="ghost"
            size="sm"
            icon={IconX}
            onClick={() => {
              p.setUploadFile(null);
              if (p.fileRef.current) p.fileRef.current.value = "";
            }}
          >
            Remove
          </Btn>
        </div>
      )}
      <Input
        label="Dockerfile path (inside archive)"
        value={p.dockerfile}
        onChange={(e: any) => p.setDockerfile(e.target.value)}
      />
    </div>
  );
}

function ConfigureCompose(p: any) {
  const services = countComposeServices(p.composeYaml);
  return (
    <div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--surface)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-2)",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          <IconCompose size={14} color="var(--muted)" />
          <span style={{ fontFamily: "var(--mono)" }}>docker-compose.yml</span>
          <div style={{ flex: 1 }} />
          <Tag tone="accent">{services > 0 ? `valid · ${services} services` : "draft"}</Tag>
        </div>
        <textarea
          value={p.composeYaml}
          onChange={(e: any) => p.setComposeYaml(e.target.value)}
          style={{
            width: "100%",
            minHeight: 460,
            border: 0,
            outline: 0,
            padding: 16,
            fontFamily: "var(--mono)",
            fontSize: 12.5,
            color: "var(--ink-2)",
            background: "#fcfbf7",
            resize: "vertical",
            lineHeight: 1.55,
          }}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Right-side context panels
// ──────────────────────────────────────────────────────────────────────

function PanelImage({ image }: { image: string }) {
  const [info, setInfo] = useState<api.DhImageInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tag, ref] = useMemo(() => {
    const [t, r] = image.split(":");
    return [t, r || "latest"];
  }, [image]);

  useEffect(() => {
    if (!image.trim() || !tag) { setInfo(null); return; }
    let killed = false;
    setInfo(null);
    setErr(null);
    const t = setTimeout(async () => {
      try {
        const r = await api.dockerhubImageInfo(image);
        if (!killed) setInfo(r);
      } catch (e: any) {
        if (!killed) setErr(String(e));
      }
    }, 350);
    return () => { killed = true; clearTimeout(t); };
  }, [image, tag]);

  const arches = useMemo(() => {
    const list: any[] = info?.tag?.images || [];
    const unique = Array.from(
      new Set(
        list
          .map((i: any) => {
            const a = i?.architecture || "";
            const v = i?.variant ? `${a}/${i.variant}` : a;
            return v;
          })
          .filter(Boolean)
      )
    );
    return unique;
  }, [info]);

  const size = info?.tag?.full_size as number | undefined;
  const lastUpdated = (info?.tag?.last_updated || info?.info?.last_updated) as string | undefined;
  const lastPusher = info?.tag?.last_updater_username as string | undefined;
  const digest = (info?.tag?.digest as string | undefined)?.replace(/^sha256:/, "");
  const fullName = info ? (info.namespace === "library" ? info.name : `${info.namespace}/${info.name}`) : tag;

  const commonEnv = commonEnvVarsFor(info?.name || tag || "");
  const isOfficial = info?.namespace === "library";

  return (
    <div className="lhq-card" style={{ padding: 18 }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 13.5, color: "var(--ink-2)", fontWeight: 500, wordBreak: "break-all" }}>
        {fullName || "—"}<span style={{ color: "var(--muted-2)" }}>:{ref}</span>
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
        digest · <span title={digest || ""}>{digest ? `sha256:${digest.slice(0, 6)}…${digest.slice(-2)}` : "—"}</span>
        {size && <> · {fmtBytes(size)}</>}
      </div>

      {err && (
        <div style={{ marginTop: 14, fontSize: 11.5, color: "oklch(0.42 0.12 25)", fontFamily: "var(--mono)" }}>{err}</div>
      )}

      <Section title="Architecture">
        {arches.length === 0 ? (
          <span style={{ fontSize: 12, color: "var(--muted-2)" }}>—</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {arches.map((a) => <Tag key={a as string}>{a as string}</Tag>)}
          </div>
        )}
      </Section>

      <Section title="Last updated">
        <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
          {lastUpdated ? `${relTime(lastUpdated)} ago` : "—"}
          {lastPusher && <span style={{ color: "var(--muted)" }}> · by <span className="mono">{lastPusher}</span></span>}
        </div>
      </Section>

      <Section title="Maintainer">
        <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
          <span className="mono">{info?.namespace || "—"}</span>
          {isOfficial && <span style={{ color: "var(--accent-ink)", marginLeft: 6, fontSize: 11.5 }}>· trusted</span>}
        </div>
      </Section>

      {commonEnv.length > 0 && (
        <Section title="Common env vars">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {commonEnv.map((v) => (
              <div key={v} style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-2)" }}>{v}</div>
            ))}
          </div>
        </Section>
      )}

      <div
        style={{
          marginTop: 14,
          padding: "8px 10px",
          background: "var(--accent-tint)",
          border: "1px solid color-mix(in oklch, var(--accent) 30%, transparent)",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--accent-ink)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <IconCheck size={12} /> Pulled on deploy. Layer cache speeds up subsequent runs.
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 10.5,
          fontFamily: "var(--mono)",
          color: "var(--muted-2)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/// Curated list of commonly-set env vars for popular official images.
function commonEnvVarsFor(name: string): string[] {
  const n = name.toLowerCase();
  if (n === "postgres") return ["POSTGRES_PASSWORD", "POSTGRES_USER", "POSTGRES_DB"];
  if (n === "mysql" || n === "mariadb")
    return ["MYSQL_ROOT_PASSWORD", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"];
  if (n === "mongo") return ["MONGO_INITDB_ROOT_USERNAME", "MONGO_INITDB_ROOT_PASSWORD", "MONGO_INITDB_DATABASE"];
  if (n === "redis") return ["REDIS_PASSWORD"];
  if (n === "rabbitmq") return ["RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS"];
  if (n === "elasticsearch") return ["ELASTIC_PASSWORD", "discovery.type", "xpack.security.enabled"];
  if (n === "nginx") return [];
  if (n === "node") return ["NODE_ENV", "PORT"];
  if (n === "python") return ["PYTHONUNBUFFERED"];
  return [];
}

function PanelGithub({
  repo,
  branch,
  commit,
  setCommit,
}: {
  repo: string;
  branch: string;
  commit: string | null;
  setCommit: (sha: string | null) => void;
}) {
  const [commits, setCommits] = useState<GhCommit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!repo.trim() || !branch.trim()) { setCommits(null); return; }
    let killed = false;
    setCommits(null);
    setErr(null);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=8`,
          { headers: { Accept: "application/vnd.github+json" } }
        );
        if (!res.ok) {
          if (killed) return;
          setErr(`${res.status}: ${(await res.json()).message || res.statusText}`);
          return;
        }
        const data: any[] = await res.json();
        if (killed) return;
        setCommits(
          data.map((c) => ({
            sha: c.sha,
            message: (c.commit.message as string).split("\n")[0],
            author: c.commit.author?.name || "—",
            date: c.commit.author?.date,
          }))
        );
      } catch (e: any) {
        if (!killed) setErr(String(e));
      }
    }, 400);
    return () => { killed = true; clearTimeout(t); };
  }, [repo, branch]);

  const buildRef = commit || branch;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="lhq-card">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span className="lhq-h3" style={{ fontSize: 14 }}>Recent commits</span>
          {commit && (
            <button
              onClick={() => setCommit(null)}
              style={{
                marginLeft: "auto",
                border: 0,
                background: "transparent",
                fontSize: 11.5,
                color: "var(--accent-ink)",
                textDecoration: "underline",
                cursor: "default",
                fontFamily: "var(--sans)",
              }}
            >
              use branch HEAD
            </button>
          )}
        </div>
        {!repo && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Type a repo to load commits.</div>}
        {repo && !commits && !err && (
          <div style={{ fontSize: 12, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>fetching…</div>
        )}
        {err && (
          <div style={{ fontSize: 12, color: "oklch(0.42 0.12 25)", fontFamily: "var(--mono)" }}>{err}</div>
        )}
        {commits?.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No commits on this branch.</div>
        )}
        {commits?.slice(0, 8).map((c, i) => {
          const selected = commit === c.sha;
          const isBranchHead = !commit && i === 0;
          return (
            <button
              key={c.sha}
              onClick={() => setCommit(c.sha)}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 10,
                padding: "8px 6px",
                borderRadius: 6,
                width: "100%",
                background: selected ? "var(--accent-tint)" : "transparent",
                border: 0,
                borderBottom: i < (commits.length - 1) ? "1px solid var(--border)" : "none",
                alignItems: "center",
                cursor: "default",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: selected || isBranchHead ? "var(--accent)" : "var(--surface-3)",
                  display: "inline-block",
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted-2)" }}>
                    {c.sha.slice(0, 7)}
                  </span>
                  {selected && <Tag tone="accent">Selected</Tag>}
                  {isBranchHead && <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--muted-2)" }}>HEAD</span>}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 2,
                  }}
                >
                  {c.message}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
                {c.author.split(" ")[0]}<br />
                {c.date ? relTime(c.date) : ""}
              </div>
            </button>
          );
        })}
      </div>

      <div className="lhq-card">
        <div
          style={{
            fontSize: 10.5,
            fontFamily: "var(--mono)",
            color: "var(--muted-2)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Build preview
        </div>
        <pre
          style={{
            margin: 0,
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >{`docker build \\
  -t lockethq/${(repo.split("/")[1] || "app")}:latest \\
  ${repo ? `https://github.com/${repo}.git#${buildRef}` : "<repo>#<ref>"}`}
        </pre>
      </div>
    </div>
  );
}

interface GhCommit { sha: string; message: string; author: string; date?: string }

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function PanelUpload({ file }: { file: File | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="lhq-card">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span className="lhq-h3" style={{ fontSize: 14 }}>Archive</span>
          <span style={{ fontSize: 11.5, color: "var(--muted-2)", fontFamily: "var(--mono)" }}>
            {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "—"}
          </span>
        </div>
        {file ? (
          <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink-2)", wordBreak: "break-all" }}>
            {file.name}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>No archive yet — drop one on the left.</div>
        )}
      </div>
      <div
        className="lhq-card"
        style={{
          background: "var(--accent-tint)",
          borderColor: "color-mix(in oklch, var(--accent) 30%, transparent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
          ⚡ Ready to build
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.5 }}>
          We send the archive to the runner as the build context and run{" "}
          <span className="mono">docker build</span> on the server. Your file never leaves the
          chosen server.
        </div>
      </div>
    </div>
  );
}

function PanelCompose({ yaml }: { yaml: string }) {
  const services = parseComposeServices(yaml);
  const volumes = parseComposeVolumes(yaml);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="lhq-card" style={{ padding: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span className="lhq-h3" style={{ fontSize: 14 }}>Service graph</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            · {services.length} services{volumes.length ? ` · ${volumes.length} volume${volumes.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        {services.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Add services to the YAML to see them here.</div>
        ) : (
          <ServiceGraph services={services} />
        )}
      </div>
      <div className="lhq-card">
        <div
          style={{
            fontSize: 10.5,
            fontFamily: "var(--mono)",
            color: "var(--muted-2)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Pre-flight
        </div>
        <Check ok label="YAML parses" />
        <Check ok={services.length > 0} label={`Services: ${services.length}`} />
        <Check ok={hasPortConflict(yaml) === null} label={hasPortConflict(yaml) || "No port conflicts on host"} />
      </div>
    </div>
  );
}

function ServiceGraph({ services }: { services: ComposeService[] }) {
  // Layered layout: column index = longest dependency depth.
  const byName: Record<string, ComposeService> = {};
  for (const s of services) byName[s.name] = s;

  function depth(name: string, seen = new Set<string>()): number {
    if (seen.has(name)) return 0;
    seen.add(name);
    const s = byName[name];
    if (!s || s.dependsOn.length === 0) return 0;
    return 1 + Math.max(...s.dependsOn.map((d) => depth(d, new Set(seen))));
  }
  const layered: ComposeService[][] = [];
  for (const s of services) {
    const d = depth(s.name);
    while (layered.length <= d) layered.push([]);
    layered[d].push(s);
  }

  const colW = 130;
  const rowH = 60;
  const padX = 12;
  const padY = 16;
  const width = padX * 2 + Math.max(1, layered.length) * colW;
  const height = padY * 2 + Math.max(1, Math.max(...layered.map((l) => l.length))) * rowH;

  const pos: Record<string, { x: number; y: number }> = {};
  layered.forEach((col, ci) => {
    const offset = (Math.max(...layered.map((l) => l.length)) - col.length) / 2;
    col.forEach((s, ri) => {
      pos[s.name] = {
        x: padX + ci * colW + 10,
        y: padY + (ri + offset) * rowH + 4,
      };
    });
  });

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--muted-2)" />
        </marker>
      </defs>
      {/* edges */}
      {services.flatMap((s) =>
        s.dependsOn.map((d) => {
          const a = pos[d];
          const b = pos[s.name];
          if (!a || !b) return null;
          const ax = a.x + 100;
          const ay = a.y + 22;
          const bx = b.x;
          const by = b.y + 22;
          const midx = (ax + bx) / 2;
          return (
            <path
              key={`${d}-${s.name}`}
              d={`M${ax},${ay} C${midx},${ay} ${midx},${by} ${bx},${by}`}
              fill="none"
              stroke="var(--muted-2)"
              strokeWidth="1"
              strokeDasharray="3 3"
              markerEnd="url(#arrow)"
            />
          );
        })
      )}
      {/* nodes */}
      {services.map((s) => {
        const p = pos[s.name];
        if (!p) return null;
        return (
          <g key={s.name} transform={`translate(${p.x}, ${p.y})`}>
            <rect
              x="0"
              y="0"
              width="100"
              height="44"
              rx="8"
              fill="var(--surface)"
              stroke="var(--border)"
            />
            <circle cx="10" cy="14" r="3" fill="var(--accent)" />
            <text
              x="20"
              y="18"
              fontSize="11.5"
              fontFamily="var(--mono)"
              fill="var(--ink-2)"
              dominantBaseline="middle"
            >
              {s.name.length > 12 ? s.name.slice(0, 11) + "…" : s.name}
            </text>
            <text
              x="10"
              y="34"
              fontSize="10"
              fontFamily="var(--mono)"
              fill="var(--muted-2)"
            >
              {s.kind}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5 }}>
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 999,
          background: ok ? "var(--accent)" : "var(--warn)",
          color: ok ? "#0E1F18" : "#3B1F00",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {ok ? <IconCheck size={11} /> : <span style={{ fontSize: 11, fontWeight: 700 }}>!</span>}
      </div>
      <span style={{ color: "var(--ink-2)" }}>{label}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 3 — Network & ports
// ──────────────────────────────────────────────────────────────────────

function NetworkStep({
  source,
  ports,
  setPorts,
  network,
  setNetwork,
}: {
  source: Source;
  ports: PortMapping[];
  setPorts: Dispatch<SetStateAction<PortMapping[]>>;
  network: string;
  setNetwork: (v: string) => void;
}) {
  if (source === "compose") {
    return (
      <div className="lhq-card" style={{ maxWidth: 720 }}>
        <div className="lhq-h3" style={{ marginBottom: 8 }}>Compose handles this for you</div>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          Networks and port mappings are defined inside your <span className="mono">docker-compose.yml</span>.
          Click Continue to skip this step.
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, maxWidth: 900 }}>
      <div className="lhq-card">
        <div className="lhq-h3" style={{ fontSize: 14, marginBottom: 10 }}>Port mappings</div>
        {ports.map((p, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 28px",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <input
              className="lhq-input"
              placeholder="host"
              value={p.host_port ?? ""}
              onChange={(ev) =>
                updatePort(setPorts, i, {
                  ...p,
                  host_port: parseInt(ev.target.value) || null,
                })
              }
            />
            <input
              className="lhq-input"
              placeholder="container"
              value={p.container_port}
              onChange={(ev) =>
                updatePort(setPorts, i, {
                  ...p,
                  container_port: parseInt(ev.target.value) || 0,
                })
              }
            />
            <input
              className="lhq-input"
              placeholder="tcp"
              value={p.protocol}
              onChange={(ev) =>
                updatePort(setPorts, i, { ...p, protocol: ev.target.value })
              }
            />
            <Btn
              variant="ghost"
              icon={IconX}
              onClick={() => setPorts(ports.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <Btn
          size="sm"
          icon={IconPlus}
          onClick={() =>
            setPorts([
              ...ports,
              { container_port: 80, host_port: 8080, protocol: "tcp", public: true },
            ])
          }
        >
          Add port
        </Btn>
      </div>

      <div className="lhq-card">
        <div className="lhq-h3" style={{ fontSize: 14, marginBottom: 10 }}>Network</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {["bridge", "host", "lockethq-proxy"].map((n) => (
            <button
              key={n}
              onClick={() => setNetwork(n)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid",
                borderColor: network === n ? "var(--ink)" : "var(--border)",
                background: network === n ? "var(--surface-2)" : "var(--surface)",
                borderRadius: 8,
                fontSize: 13,
                cursor: "default",
                textAlign: "left",
                fontFamily: "var(--mono)",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  border: "1px solid var(--border-strong)",
                  background: network === n ? "var(--ink)" : "transparent",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {network === n && <IconCheck size={9} color="#FAFAF7" />}
              </span>
              {n}
            </button>
          ))}
        </div>
        <p style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          <span className="mono">lockethq-proxy</span> is required if you plan to attach a domain
          via Domains → it lets Traefik reach this container by name.
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 4 — Volumes & env
// ──────────────────────────────────────────────────────────────────────

function VolumesStep({
  source,
  env,
  setEnv,
  mounts,
  setMounts,
  restart,
  setRestart,
  composeYaml,
  composeEnv,
  setComposeEnv,
}: {
  source: Source;
  env: EnvVar[];
  setEnv: Dispatch<SetStateAction<EnvVar[]>>;
  mounts: Mount[];
  setMounts: Dispatch<SetStateAction<Mount[]>>;
  restart: "no" | "always" | "unless-stopped" | "on-failure";
  setRestart: (v: any) => void;
  composeYaml: string;
  composeEnv: Record<string, string>;
  setComposeEnv: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  if (source === "compose") {
    return (
      <ComposeEnvSection
        yaml={composeYaml}
        values={composeEnv}
        setValues={setComposeEnv}
      />
    );
  }

  function updateMount(i: number, m: Mount) {
    setMounts((prev) => {
      const next = [...prev];
      next[i] = m;
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 900 }}>
      <div className="lhq-card">
        <div className="lhq-h3" style={{ fontSize: 14, marginBottom: 6 }}>Volumes</div>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Persist data outside the container. <b>Bind mounts</b> map a host path (e.g.{" "}
          <span className="mono">/srv/app/data</span>); <b>volume</b> uses a named Docker volume;{" "}
          <b>tmpfs</b> is a memory-only mount.
        </p>
        {mounts.length === 0 ? (
          <div
            style={{
              padding: "12px 14px",
              border: "1px dashed var(--border)",
              borderRadius: 8,
              color: "var(--muted)",
              fontSize: 12.5,
              marginBottom: 8,
            }}
          >
            No volumes yet — your container will have ephemeral storage only.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "110px 1fr 18px 1fr 90px 28px 28px",
                gap: 6,
                fontSize: 10.5,
                color: "var(--muted-2)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
                padding: "0 4px",
              }}
            >
              <span>Kind</span>
              <span>Source</span>
              <span />
              <span>Container path</span>
              <span style={{ textAlign: "center" }}>Mode</span>
              <span />
              <span />
            </div>
            {mounts.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 18px 1fr 90px 28px 28px",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <select
                  className="lhq-input"
                  value={m.kind || "bind"}
                  onChange={(ev) => updateMount(i, { ...m, kind: ev.target.value })}
                  style={{ paddingLeft: 10, fontFamily: "var(--mono)", fontSize: 12.5 }}
                >
                  <option value="bind">bind</option>
                  <option value="volume">volume</option>
                  <option value="tmpfs">tmpfs</option>
                </select>
                <input
                  className="lhq-input"
                  placeholder={m.kind === "volume" ? "volume-name" : "/host/path"}
                  value={m.source}
                  onChange={(ev) => updateMount(i, { ...m, source: ev.target.value })}
                  style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
                  disabled={m.kind === "tmpfs"}
                />
                <span style={{ textAlign: "center", color: "var(--muted-2)", fontFamily: "var(--mono)" }}>→</span>
                <input
                  className="lhq-input"
                  placeholder="/container/path"
                  value={m.destination}
                  onChange={(ev) => updateMount(i, { ...m, destination: ev.target.value })}
                  style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
                />
                <button
                  onClick={() => updateMount(i, { ...m, read_only: !m.read_only })}
                  style={{
                    height: 32,
                    padding: 0,
                    borderRadius: 8,
                    border: "1px solid",
                    borderColor: m.read_only ? "var(--warn)" : "var(--border)",
                    background: m.read_only ? "var(--warn-tint)" : "var(--surface)",
                    color: m.read_only ? "oklch(0.42 0.10 70)" : "var(--muted)",
                    fontSize: 12,
                    fontFamily: "var(--mono)",
                    cursor: "default",
                  }}
                >
                  {m.read_only ? "ro" : "rw"}
                </button>
                <Btn
                  variant="ghost"
                  icon={IconX}
                  onClick={() => setMounts(mounts.filter((_, j) => j !== i))}
                />
                <span />
              </div>
            ))}
          </div>
        )}
        <Btn
          size="sm"
          icon={IconPlus}
          onClick={() =>
            setMounts([
              ...mounts,
              { kind: "bind", source: "", destination: "", read_only: false },
            ])
          }
        >
          Add volume
        </Btn>
      </div>

      <div className="lhq-card">
        <div className="lhq-h3" style={{ fontSize: 14, marginBottom: 10 }}>Environment variables</div>
        {env.map((e, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 28px",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <input
              className="lhq-input"
              placeholder="KEY"
              value={e.key}
              onChange={(ev) =>
                updateEnv(setEnv, i, { ...e, key: ev.target.value })
              }
            />
            <input
              className="lhq-input"
              placeholder="value"
              value={e.value}
              onChange={(ev) =>
                updateEnv(setEnv, i, { ...e, value: ev.target.value })
              }
            />
            <Btn
              variant="ghost"
              icon={IconX}
              onClick={() => setEnv(env.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <Btn
          size="sm"
          icon={IconPlus}
          onClick={() => setEnv([...env, { key: "", value: "", secret: false }])}
        >
          Add env var
        </Btn>
      </div>

      <div className="lhq-card">
        <div className="lhq-h3" style={{ fontSize: 14, marginBottom: 10 }}>Restart policy</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["no", "on-failure", "unless-stopped", "always"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRestart(r)}
              style={{
                height: 32,
                padding: "0 14px",
                borderRadius: 8,
                border: "1px solid",
                borderColor: restart === r ? "var(--ink)" : "var(--border)",
                background: restart === r ? "var(--ink)" : "var(--surface)",
                color: restart === r ? "#FAFAF7" : "var(--ink)",
                fontSize: 12.5,
                fontFamily: "var(--mono)",
                cursor: "default",
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <p style={{ marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
          <b>unless-stopped</b> keeps the container running across daemon restarts but lets you
          stop it manually.
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 5 — Review
// ──────────────────────────────────────────────────────────────────────

function ReviewStep(p: any) {
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="lhq-card" style={{ marginBottom: 14 }}>
        <Row k="Server" v={p.servers.find((s: any) => s.id === p.serverId)?.name || "—"} />
        <Row k="Source" v={p.source} />
        {p.source === "image" && <Row k="Image" v={p.image} />}
        {p.source === "github" && (
          <>
            <Row k="Repo" v={`${p.repo}#${p.branch}`} />
            <Row k="Dockerfile" v={joinPath(p.workingDir, p.dockerfile)} />
          </>
        )}
        {p.source === "upload" && (
          <>
            <Row k="Archive" v={p.uploadFile?.name || "(none)"} />
            <Row
              k="Size"
              v={p.uploadFile ? `${(p.uploadFile.size / 1024 / 1024).toFixed(2)} MB` : "—"}
            />
          </>
        )}
        {p.source === "compose" && <Row k="Compose" v={`${p.composeYaml.split("\n").length} lines`} />}
        <Row k="Name" v={p.name || `(auto: ${p.defaultName()})`} />
        {p.source !== "compose" && (
          <>
            <Row k="Env vars" v={p.env.length === 0 ? "—" : `${p.env.length} keys`} />
            <Row
              k="Ports"
              v={
                p.ports.length === 0
                  ? "—"
                  : p.ports
                      .map((x: PortMapping) => `${x.host_port ?? "?"}→${x.container_port}/${x.protocol}`)
                      .join(", ")
              }
            />
            <Row k="Network" v={p.network} />
            <Row k="Restart" v={p.restart} />
          </>
        )}
      </div>
      {p.err && (
        <div
          style={{
            padding: 12,
            border: "1px solid color-mix(in oklch, var(--danger) 30%, transparent)",
            background: "var(--danger-tint)",
            color: "oklch(0.42 0.12 25)",
            borderRadius: 8,
            fontSize: 12.5,
            fontFamily: "var(--mono)",
            whiteSpace: "pre-wrap",
          }}
        >
          {p.err}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ width: 140, fontSize: 12, color: "var(--muted)" }}>{k}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--ink-2)" }}>{v}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function updateEnv(set: Dispatch<SetStateAction<EnvVar[]>>, i: number, e: EnvVar) {
  set((prev) => {
    const arr = [...prev];
    arr[i] = e;
    return arr;
  });
}
function updatePort(set: Dispatch<SetStateAction<PortMapping[]>>, i: number, p: PortMapping) {
  set((prev) => {
    const arr = [...prev];
    arr[i] = p;
    return arr;
  });
}
function joinPath(dir: string, file: string): string {
  const d = dir.replace(/\/$/, "");
  if (!d || d === ".") return file;
  return `${d}/${file}`;
}
interface ComposeService {
  name: string;
  kind: string; // "image" | "build"
  dependsOn: string[];
}

interface ComposeEnvRef {
  name: string;
  required: boolean;
  defaultValue: string | null;
}

function parseComposeEnvRefs(yaml: string): ComposeEnvRef[] {
  const seen = new Map<string, ComposeEnvRef>();

  // ${VAR}, ${VAR?msg}, ${VAR:?msg}, ${VAR-default}, ${VAR:-default}.
  // Group 2 captures just the operator char ('-' or '?'); group 3 is the
  // default/message after it. The colon (`:`) is allowed before either op.
  const braced = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?([-?])([^}]*))?\}/g;
  let m: RegExpExecArray | null;
  while ((m = braced.exec(yaml))) {
    const name = m[1];
    const op = m[2] || "";
    const val = m[3] || "";
    const required = op === "?" || op === "";
    const defaultValue = op === "-" ? val : null;
    const prior = seen.get(name);
    if (!prior) {
      seen.set(name, { name, required, defaultValue });
    } else {
      seen.set(name, {
        name,
        required: prior.required || required,
        defaultValue: prior.defaultValue ?? defaultValue,
      });
    }
  }

  // $VAR form (no braces). Required since there's no syntax for a default.
  const bare = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = bare.exec(yaml))) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.set(name, { name, required: true, defaultValue: null });
    }
  }

  return [...seen.values()];
}

function ComposeEnvSection({
  yaml,
  values,
  setValues,
}: {
  yaml: string;
  values: Record<string, string>;
  setValues: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const refs = useMemo(() => parseComposeEnvRefs(yaml), [yaml]);
  const required = refs.filter((r) => r.required && !r.defaultValue);
  const optional = refs.filter((r) => !(r.required && !r.defaultValue));
  const missing = required.filter((r) => !(values[r.name] || "").trim());

  function update(name: string, val: string) {
    setValues((prev) => ({ ...prev, [name]: val }));
  }

  if (refs.length === 0) {
    return (
      <div className="lhq-card" style={{ maxWidth: 720 }}>
        <div className="lhq-h3" style={{ marginBottom: 8 }}>No env vars to set</div>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
          Your <span className="mono">docker-compose.yml</span> doesn't reference any{" "}
          <span className="mono">${"{VAR}"}</span> interpolations. Click Continue.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 900 }}>
      <div className="lhq-card">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
          <span className="lhq-h3" style={{ fontSize: 14 }}>Compose env vars</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--muted)" }}>
            · {refs.length} referenced
            {missing.length > 0 && (
              <>
                {" "}
                ·{" "}
                <span style={{ color: "oklch(0.42 0.12 25)" }}>
                  {missing.length} missing
                </span>
              </>
            )}
          </span>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, lineHeight: 1.5 }}>
          We detected <span className="mono">${"{VAR}"}</span> references in your compose
          file. Values you set here are written to a <span className="mono">.env</span> next to
          the YAML on the server so <span className="mono">docker compose</span> interpolates
          them.
        </p>

        {required.length > 0 && (
          <>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                color: "var(--muted-2)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Required
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {required.map((r) => {
                const filled = !!(values[r.name] || "").trim();
                return (
                  <div
                    key={r.name}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "260px 1fr 20px",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 12.5,
                        color: "var(--ink-2)",
                      }}
                    >
                      {r.name}
                    </span>
                    <input
                      className="lhq-input"
                      value={values[r.name] || ""}
                      onChange={(e) => update(r.name, e.target.value)}
                      placeholder={`required · ${r.name}`}
                      style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
                      type={isSecretKey(r.name) ? "password" : "text"}
                    />
                    <span
                      title={filled ? "set" : "missing"}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: filled ? "var(--accent)" : "var(--danger)",
                        display: "inline-block",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {optional.length > 0 && (
          <>
            <div
              style={{
                fontSize: 10.5,
                fontFamily: "var(--mono)",
                color: "var(--muted-2)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Optional (have defaults)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {optional.map((r) => (
                <div
                  key={r.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "260px 1fr 20px",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12.5,
                      color: "var(--ink-2)",
                    }}
                  >
                    {r.name}
                  </span>
                  <input
                    className="lhq-input"
                    value={values[r.name] || ""}
                    onChange={(e) => update(r.name, e.target.value)}
                    placeholder={r.defaultValue || "(leave blank to use compose default)"}
                    style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}
                    type={isSecretKey(r.name) ? "password" : "text"}
                  />
                  <span style={{ width: 10 }} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function isSecretKey(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("password") ||
    n.includes("pass") ||
    n.includes("secret") ||
    n.includes("token") ||
    n.includes("key") ||
    n.includes("dsn")
  );
}

function parseComposeServices(yaml: string): ComposeService[] {
  const out: ComposeService[] = [];
  const lines = yaml.split("\n");
  let inServices = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, "");
    if (/^services:/.test(line)) { inServices = true; i++; continue; }
    if (inServices) {
      if (/^[^ \t]/.test(line) && line.trim() !== "") { inServices = false; continue; }
      const m = line.match(/^  ([\w.-]+):\s*$/);
      if (m) {
        const name = m[1];
        let kind = "image";
        const deps: string[] = [];
        // scan service body until next top-level entry under services
        let j = i + 1;
        while (j < lines.length) {
          const sub = lines[j];
          if (/^  [^ ]/.test(sub)) break; // next service
          if (/^[^ ]/.test(sub) && sub.trim() !== "") break; // back to top-level
          if (/^\s+build:/.test(sub)) kind = "build";
          if (/^\s+image:/.test(sub) && kind !== "build") kind = "image";
          // depends_on can be a list (- name) or a map (name:)
          if (/^\s+depends_on:/.test(sub)) {
            let k = j + 1;
            while (k < lines.length) {
              const inner = lines[k];
              if (!/^\s/.test(inner)) break;
              const m1 = inner.match(/^\s+-\s+([\w.-]+)\s*$/);
              const m2 = inner.match(/^\s+([\w.-]+):\s*$/);
              if (m1) deps.push(m1[1]);
              else if (m2 && !["condition", "restart"].includes(m2[1])) deps.push(m2[1]);
              else if (!/^\s{6,}/.test(inner)) break;
              k++;
            }
          }
          j++;
        }
        out.push({ name, kind, dependsOn: deps });
        i = j;
        continue;
      }
    }
    i++;
  }
  return out;
}

function parseComposeVolumes(yaml: string): string[] {
  const out: string[] = [];
  const lines = yaml.split("\n");
  let inVolumes = false;
  for (const line of lines) {
    if (/^volumes:\s*$/.test(line)) { inVolumes = true; continue; }
    if (inVolumes) {
      if (/^[^ \t]/.test(line) && line.trim() !== "") break;
      const m = line.match(/^  ([\w.-]+):/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}
function countComposeServices(yaml: string): number {
  return parseComposeServices(yaml).length;
}
function hasPortConflict(yaml: string): string | null {
  const ports: string[] = [];
  for (const line of yaml.split("\n")) {
    const m = line.match(/['"]?(\d+):\d+['"]?/);
    if (m) ports.push(m[1]);
  }
  const seen = new Set<string>();
  for (const p of ports) {
    if (seen.has(p)) return `Port conflict on host: ${p}`;
    seen.add(p);
  }
  return null;
}

const SAMPLE_COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    restart: unless-stopped
`;
