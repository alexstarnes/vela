import { useState } from "react";

// ─── Tokens ──────────────────────────────────────────────────────
const C = {
  amber: { 50:"#FFF8ED",100:"#FEEFD6",200:"#FCD9A4",300:"#F9BD62",400:"#F5A623",500:"#E08F0D",600:"#B86F08",700:"#8A5009",800:"#5C360E",900:"#3D2409" },
  stone: { 0:"#FFFFFF",25:"#FAFAF8",50:"#F5F4F1",100:"#ECEAE4",200:"#D8D5CC",300:"#B8B4A8",400:"#8E897B",500:"#6B665A",600:"#4E4A40",700:"#3A3731",800:"#282622",900:"#1A1917",950:"#0F0E0D" },
  success:"#3D8B5C", warning:"#C27D1A", error:"#C4413A", info:"#4A7AB5",
  purple:"#7C3AED",
  dark: { bg:"#111110", surface:"#1A1918", surface2:"#222120", border:"#2E2D2A" },
};

// ─── Primitives ──────────────────────────────────────────────────
function Section({ num, title, children }) {
  return (
    <section className="pb-14 mb-14 border-b" style={{ borderColor: C.stone[100] }}>
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-mono text-[11px] tracking-widest" style={{ color: C.amber[400] }}>{num}</span>
        <h2 className="text-[22px] font-bold tracking-tight" style={{ fontFamily: "Syne, system-ui" }}>{title}</h2>
      </div>
      <div className="mt-7">{children}</div>
    </section>
  );
}
function Sub({ title, children }) { return <div className="mt-9"><h3 className="text-sm font-semibold tracking-tight mb-3" style={{ fontFamily: "Syne, system-ui" }}>{title}</h3>{children}</div>; }
function Box({ accent, children }) { return <div className="rounded-lg p-4 text-sm leading-relaxed" style={{ background: accent ? C.amber[50] : C.stone[50], border: `1px solid ${accent ? C.amber[200] : C.stone[200]}`, color: C.stone[700] }}>{children}</div>; }
function Badge({ children, bg, fg }) { return <span className="inline-block text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ background: bg || C.stone[100], color: fg || C.stone[500] }}>{children}</span>; }

function ScreenLabel({ children }) {
  return <div className="text-[10px] font-mono tracking-wider uppercase mb-2 mt-8" style={{ color: C.amber[500] }}>{children}</div>;
}

// ─── Reusable mock pieces ────────────────────────────────────────
function Sidebar({ active = "Tasks" }) {
  const items = [
    { icon: "◻", label: "Tasks" }, { icon: "◆", label: "Agents" }, { icon: "▤", label: "Projects" },
    { icon: "▧", label: "Skills" }, { icon: "◷", label: "Scheduler" }, { icon: "▥", label: "Activity" },
  ];
  return (
    <div className="w-44 shrink-0 flex flex-col p-3 gap-0.5" style={{ background: C.stone[25], borderRight: `1px solid ${C.stone[100]}` }}>
      <div className="mb-3 px-2 text-base font-bold tracking-tight" style={{ fontFamily: "Syne, system-ui" }}>vela<span style={{ color: C.amber[400] }}>.</span></div>
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs" style={{ background: active === i.label ? C.stone[100] : "transparent", color: active === i.label ? C.stone[900] : C.stone[500], fontWeight: active === i.label ? 500 : 400 }}>
          <span className="text-[10px] opacity-50">{i.icon}</span>{i.label}
        </div>
      ))}
      <div className="mt-auto"><div className="flex items-center gap-2 px-2.5 py-1.5 text-xs" style={{ color: C.stone[400] }}><span className="text-[10px]">⚙</span>Settings</div></div>
    </div>
  );
}

function TopBar({ title, breadcrumb, actions }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: C.stone[100] }}>
      <div>
        {breadcrumb && <p className="text-[10px] font-mono" style={{ color: C.stone[400] }}>{breadcrumb}</p>}
        <p className="text-base font-bold tracking-tight" style={{ fontFamily: "Syne, system-ui" }}>{title}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

function Btn({ children, primary, small }) {
  return <button className={`text-[11px] font-mono px-2.5 py-1 rounded-md ${small ? "text-[10px] px-2 py-0.5" : ""}`} style={{ background: primary ? C.amber[400] : C.stone[100], color: primary ? "#fff" : C.stone[600] }}>{children}</button>;
}

function TaskCard({ title, agent, priority, cost, status, subtasks }) {
  const priDot = { low: C.stone[300], medium: C.info, high: C.amber[500], urgent: C.error }[priority] || C.stone[300];
  const stColor = { in_progress: C.amber[500], review: C.purple, done: C.success, open: C.info, blocked: C.error, waiting_for_human: C.warning, backlog: C.stone[400] }[status] || C.stone[400];
  return (
    <div className="rounded-md p-2.5 mb-1.5" style={{ background: "#fff", border: `1px solid ${C.stone[200]}` }}>
      <div className="flex items-start justify-between gap-1.5 mb-1.5">
        <p className="text-[11px] font-medium leading-tight" style={{ color: C.stone[700] }}>{title}</p>
        <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1" style={{ background: priDot }} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold" style={{ background: C.stone[100], color: C.stone[500] }}>{agent?.[0]}</div>
          <span className="text-[9px]" style={{ color: C.stone[400] }}>{agent}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {cost && <span className="text-[9px] font-mono" style={{ color: C.stone[400] }}>{cost}</span>}
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: stColor + "15", color: stColor }}>{status?.replace(/_/g, " ")}</span>
        </div>
      </div>
      {subtasks && <div className="mt-1.5 text-[9px] font-mono" style={{ color: C.stone[400] }}>{subtasks} subtasks</div>}
    </div>
  );
}

function KanbanCol({ title, count, children }) {
  return (
    <div className="rounded-lg p-2 min-w-0" style={{ background: C.stone[50] }}>
      <div className="flex items-center justify-between mb-2 px-0.5">
        <p className="text-[9px] font-mono uppercase tracking-wider" style={{ color: C.stone[400] }}>{title}</p>
        <span className="text-[9px] font-mono" style={{ color: C.stone[300] }}>{count}</span>
      </div>
      {children}
    </div>
  );
}

function EventRow({ type, time, agent, content }) {
  const s = { status_change: { c: C.stone[400], i: "↻" }, message: { c: C.amber[400], i: "◆" }, tool_call: { c: C.info, i: "⚡" }, budget_warning: { c: C.warning, i: "⚠" }, error: { c: C.error, i: "✕" }, delegation: { c: C.purple, i: "↗" }, heartbeat_start: { c: C.stone[300], i: "◷" }, heartbeat_end: { c: C.stone[300], i: "◷" }, loop_detected: { c: C.error, i: "↻" } }[type] || { c: C.stone[400], i: "·" };
  return (
    <div className="flex gap-2.5 text-[11px]">
      <div className="flex flex-col items-center gap-0.5 pt-0.5"><span style={{ color: s.c, fontSize: 9 }}>{s.i}</span><div className="w-px flex-1" style={{ background: C.stone[100] }} /></div>
      <div className="flex-1 pb-2">
        <div className="flex items-baseline gap-1.5 mb-0.5">
          {agent && <span className="font-medium" style={{ color: C.stone[700] }}>{agent}</span>}
          <span className="font-mono text-[9px]" style={{ color: C.stone[300] }}>{time}</span>
          <span className="font-mono text-[9px] px-1 py-0.5 rounded" style={{ background: s.c + "12", color: s.c }}>{type.replace(/_/g, " ")}</span>
        </div>
        <p style={{ color: C.stone[600] }}>{content}</p>
      </div>
    </div>
  );
}

function BudgetBar({ used, total, warn }) {
  const pct = Math.min((used / total) * 100, 100);
  const barColor = pct > 80 ? C.error : pct > 60 ? C.warning : C.amber[400];
  return (
    <div>
      <div className="flex justify-between text-[9px] font-mono mb-0.5" style={{ color: C.stone[400] }}><span>Budget</span><span>${used.toFixed(2)} / ${total.toFixed(2)}</span></div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.stone[100] }}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} /></div>
    </div>
  );
}

// ─── Screen Mockups ──────────────────────────────────────────────
function ScreenFrame({ children, label }) {
  return (
    <div>
      {label && <ScreenLabel>{label}</ScreenLabel>}
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.stone[200]}`, minHeight: 360 }}>
        <div className="flex" style={{ minHeight: 360 }}>{children}</div>
      </div>
    </div>
  );
}

function TaskBoardScreen() {
  return (
    <ScreenFrame label="Screen — /tasks (Kanban Board)">
      <Sidebar active="Tasks" />
      <div className="flex-1 flex flex-col">
        <TopBar title="All Tasks" breadcrumb="Tasks" actions={<><Btn>⟳ Heartbeat</Btn><Btn primary>+ New Task</Btn></>} />
        {/* Filter bar */}
        <div className="flex items-center gap-2 px-5 py-2 border-b" style={{ borderColor: C.stone[100] }}>
          <span className="text-[10px] font-mono" style={{ color: C.stone[400] }}>Filter:</span>
          <Badge bg={C.info + "18"} fg={C.info}>All Projects</Badge>
          <Badge bg={C.stone[100]} fg={C.stone[500]}>All Agents</Badge>
          <Badge bg={C.stone[100]} fg={C.stone[500]}>All Priorities</Badge>
          <div className="ml-auto flex gap-1.5">
            <Badge bg={C.amber[100]} fg={C.amber[700]}>Board</Badge>
            <Badge bg={C.stone[50]} fg={C.stone[400]}>List</Badge>
          </div>
        </div>
        {/* Approval banner */}
        <div className="mx-4 mt-3 rounded-lg p-2.5 flex items-center gap-2.5" style={{ background: C.amber[50], border: `1px solid ${C.amber[200]}` }}>
          <span className="text-[11px]">⚠</span>
          <div className="flex-1"><p className="text-[11px] font-medium" style={{ color: C.stone[800] }}>Lead Engineer wants to delegate</p><p className="text-[9px]" style={{ color: C.stone[500] }}>Create "Write integration tests" → Junior Dev</p></div>
          <Btn small>Approve</Btn><Btn small>Reject</Btn>
        </div>
        {/* Kanban */}
        <div className="flex-1 grid grid-cols-5 gap-2 p-4 overflow-hidden">
          <KanbanCol title="Backlog" count="2">
            <TaskCard title="Investigate RAG options" agent="Researcher" priority="low" status="backlog" />
            <TaskCard title="Add webhook support" agent="" priority="low" status="backlog" />
          </KanbanCol>
          <KanbanCol title="Open" count="3">
            <TaskCard title="Write API tests" agent="Engineer" priority="medium" cost="$0.00" status="open" />
            <TaskCard title="Design settings page" agent="Designer" priority="medium" status="open" />
            <TaskCard title="Review MCP spec" agent="Researcher" priority="low" status="open" />
          </KanbanCol>
          <KanbanCol title="In Progress" count="2">
            <TaskCard title="Implement heartbeat loop" agent="Lead Eng" priority="urgent" cost="$0.42" status="in_progress" subtasks="2" />
            <TaskCard title="Research vector DBs" agent="Researcher" priority="high" cost="$0.18" status="in_progress" />
          </KanbanCol>
          <KanbanCol title="Review" count="1">
            <TaskCard title="Update README" agent="Writer" priority="medium" cost="$0.06" status="review" />
          </KanbanCol>
          <KanbanCol title="Done" count="4">
            <TaskCard title="Setup Drizzle schema" agent="Lead Eng" priority="high" cost="$0.31" status="done" />
            <TaskCard title="Configure node-cron" agent="Engineer" priority="medium" cost="$0.12" status="done" />
          </KanbanCol>
        </div>
      </div>
    </ScreenFrame>
  );
}

function TaskDetailScreen() {
  return (
    <ScreenFrame label="Screen — /tasks/[id] (Task Detail)">
      <Sidebar active="Tasks" />
      <div className="flex-1 flex flex-col">
        <TopBar title="Implement heartbeat loop" breadcrumb="Tasks / Vela Core / HB-042" actions={<><Badge bg={C.amber[100]} fg={C.amber[700]}>in progress</Badge><Btn>→ Review</Btn><Btn>⏸ Block</Btn></>} />
        <div className="flex flex-1 overflow-hidden">
          {/* Main thread */}
          <div className="flex-1 flex flex-col">
            {/* Meta row */}
            <div className="flex items-center gap-4 px-5 py-2.5 text-[10px] font-mono border-b" style={{ borderColor: C.stone[100], color: C.stone[400] }}>
              <span>Agent: <strong style={{ color: C.stone[700] }}>Lead Engineer</strong></span>
              <span>Priority: <span style={{ color: C.error }}>urgent</span></span>
              <span>Cost: <span style={{ color: C.stone[700] }}>$0.42</span></span>
              <span>Tokens: 12,847</span>
            </div>
            {/* Event thread */}
            <div className="flex-1 overflow-auto p-5 space-y-0">
              <EventRow type="status_change" time="2:14 PM" content="open → in_progress" />
              <EventRow type="message" time="2:14 PM" agent="Lead Engineer" content="Starting work on heartbeat loop. Loading project context and skills: orchestration-patterns.md, heartbeat-spec.md" />
              <EventRow type="tool_call" time="2:15 PM" content="get_project_context → returned 3 skills, 2 active tasks" />
              <EventRow type="tool_call" time="2:15 PM" content="create_subtask → 'Write checkout lock logic' assigned to Engineer" />
              <EventRow type="delegation" time="2:15 PM" agent="Lead Engineer" content="Delegated: 'Write checkout lock logic' → Engineer (auto-approved, same project)" />
              <EventRow type="message" time="2:15 PM" agent="Lead Engineer" content="Implementing the main heartbeat execution function. Using atomic task checkout with row-level locks to prevent duplicate processing." />
              <EventRow type="tool_call" time="2:16 PM" content="create_subtask → 'Write unit tests for checkout' assigned to Engineer" />
              <EventRow type="budget_warning" time="2:16 PM" content="Agent at 82% of monthly budget ($41.00 / $50.00)" />
              <EventRow type="message" time="2:16 PM" agent="Lead Engineer" content="Completed initial implementation of executeHeartbeat(). Moving to review for your approval." />
              <EventRow type="status_change" time="2:16 PM" content="in_progress → review" />
            </div>
            {/* User input */}
            <div className="p-3 flex gap-2" style={{ borderTop: `1px solid ${C.stone[100]}`, background: C.stone[25] }}>
              <input type="text" placeholder="Add a note or respond to agent..." className="flex-1 text-[11px] px-3 py-2 rounded-md outline-none" style={{ border: `1px solid ${C.stone[200]}`, background: "#fff" }} readOnly />
              <Btn primary>Send</Btn>
            </div>
          </div>
          {/* Right sidebar */}
          <div className="w-48 shrink-0 p-4 space-y-4 border-l overflow-auto" style={{ borderColor: C.stone[100], background: C.stone[25] }}>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: C.stone[400] }}>Goal ancestry</p>
              <div className="text-[10px] space-y-1" style={{ color: C.stone[500] }}>
                <p style={{ color: C.stone[700] }}>Vela Core</p>
                <p className="pl-2 border-l" style={{ borderColor: C.stone[200] }}>Build autonomous heartbeat scheduler</p>
                <p className="pl-4 border-l" style={{ borderColor: C.amber[200], color: C.amber[600] }}>Implement heartbeat loop</p>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: C.stone[400] }}>Subtasks</p>
              <div className="space-y-1">
                <div className="text-[10px] flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: C.amber[400] }} /><span style={{ color: C.stone[600] }}>Write checkout lock logic</span></div>
                <div className="text-[10px] flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: C.info }} /><span style={{ color: C.stone[600] }}>Write unit tests for checkout</span></div>
              </div>
            </div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: C.stone[400] }}>Cost breakdown</p>
              <div className="text-[10px] font-mono space-y-0.5" style={{ color: C.stone[500] }}>
                <div className="flex justify-between"><span>Model calls</span><span>$0.38</span></div>
                <div className="flex justify-between"><span>Tool calls</span><span>$0.04</span></div>
                <div className="flex justify-between border-t pt-0.5" style={{ borderColor: C.stone[200], color: C.stone[700] }}><span>Total</span><span>$0.42</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}

function AgentsListScreen() {
  return (
    <ScreenFrame label="Screen — /agents (Agent Registry)">
      <Sidebar active="Agents" />
      <div className="flex-1 flex flex-col">
        <TopBar title="Agents" breadcrumb="Agent Registry" actions={<Btn primary>+ New Agent</Btn>} />
        <div className="p-4 grid grid-cols-2 gap-3 overflow-auto">
          {[
            { name: "Lead Engineer", role: "lead", model: "Claude Sonnet 4", cron: "*/15 * * * *", budget: 50, used: 41, status: "active", tasks: 3 },
            { name: "Engineer", role: "engineer", model: "Claude Sonnet 4", cron: "*/15 * * * *", budget: 30, used: 8.2, status: "active", tasks: 2 },
            { name: "Researcher", role: "researcher", model: "Claude Haiku 4.5", cron: "*/30 * * * *", budget: 20, used: 4.6, status: "active", tasks: 1 },
            { name: "Writer", role: "writer", model: "Qwen3 8B (Local)", cron: "0 */2 * * *", budget: 10, used: 0.8, status: "active", tasks: 1 },
            { name: "Junior Dev", role: "engineer", model: "Qwen3 Coder (Local)", cron: "*/30 * * * *", budget: 15, used: 15, status: "budget_exceeded", tasks: 0 },
            { name: "Analyst", role: "analyst", model: "Claude Haiku 4.5", cron: "0 9 * * *", budget: 25, used: 0, status: "paused", tasks: 0 },
          ].map(a => (
            <div key={a.name} className="rounded-lg p-4" style={{ background: "#fff", border: `1px solid ${C.stone[200]}` }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: C.amber[100], color: C.amber[700] }}>{a.name.split(" ").map(w => w[0]).join("")}</div>
                  <div>
                    <p className="text-sm font-semibold">{a.name}</p>
                    <p className="text-[10px]" style={{ color: C.stone[400] }}>{a.role}</p>
                  </div>
                </div>
                <Badge bg={a.status === "active" ? "#E8F5E9" : a.status === "budget_exceeded" ? C.error + "18" : C.stone[100]} fg={a.status === "active" ? C.success : a.status === "budget_exceeded" ? C.error : C.stone[500]}>{a.status.replace(/_/g," ")}</Badge>
              </div>
              <div className="text-[10px] font-mono space-y-1 mb-3" style={{ color: C.stone[400] }}>
                <div className="flex justify-between"><span>Model</span><span style={{ color: C.stone[600] }}>{a.model}</span></div>
                <div className="flex justify-between"><span>Schedule</span><span style={{ color: C.stone[600] }}>{a.cron}</span></div>
                <div className="flex justify-between"><span>Active tasks</span><span style={{ color: C.stone[600] }}>{a.tasks}</span></div>
              </div>
              <BudgetBar used={a.used} total={a.budget} />
            </div>
          ))}
        </div>
      </div>
    </ScreenFrame>
  );
}

function AgentDetailScreen() {
  return (
    <ScreenFrame label="Screen — /agents/[id] (Agent Detail + Config)">
      <Sidebar active="Agents" />
      <div className="flex-1 flex flex-col">
        <TopBar title="Lead Engineer" breadcrumb="Agents / Lead Engineer" actions={<><Badge bg="#E8F5E9" fg={C.success}>active</Badge><Btn>⏸ Pause</Btn><Btn>Edit</Btn></>} />
        <div className="flex flex-1 overflow-hidden">
          {/* Config panel */}
          <div className="flex-1 p-5 overflow-auto space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[["Role","lead"],["Model","Claude Sonnet 4"],["Schedule","*/15 * * * * (every 15 min)"],["Max iterations","10"],["Project","Vela Core"],["Parent agent","None (top-level)"]].map(([l,v])=>(
                <div key={l}><p className="text-[9px] font-mono uppercase tracking-wider mb-0.5" style={{ color: C.stone[400] }}>{l}</p><p className="text-sm" style={{ color: C.stone[700] }}>{v}</p></div>
              ))}
            </div>
            <div><p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: C.stone[400] }}>System prompt</p><div className="rounded-md p-3 text-[11px] leading-relaxed" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}`, color: C.stone[600] }}>You are the Lead Engineer for the Vela project. You architect and implement core systems, delegate implementation tasks to other engineers, and ensure code quality. Always explain your reasoning before taking action.</div></div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: C.stone[400] }}>Budget</p>
              <BudgetBar used={41} total={50} />
              <p className="text-[9px] font-mono mt-1" style={{ color: C.stone[400] }}>Resets: May 1, 2026 · Warning at 80% · Hard stop at 100%</p>
            </div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: C.stone[400] }}>Recent heartbeats</p>
              <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${C.stone[200]}` }}>
                {[
                  { time: "2:15 PM", tasks: 1, tokens: 4821, cost: "$0.14", status: "completed" },
                  { time: "2:00 PM", tasks: 1, tokens: 6102, cost: "$0.18", status: "completed" },
                  { time: "1:45 PM", tasks: 0, tokens: 0, cost: "$0.00", status: "completed" },
                  { time: "1:30 PM", tasks: 1, tokens: 3244, cost: "$0.10", status: "completed" },
                  { time: "1:15 PM", tasks: 1, tokens: 8920, cost: "$0.26", status: "timeout" },
                ].map((h, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-[10px] font-mono border-b" style={{ borderColor: C.stone[100], color: C.stone[500] }}>
                    <span style={{ color: C.stone[700] }}>{h.time}</span>
                    <span>{h.tasks} tasks</span>
                    <span>{h.tokens.toLocaleString()} tok</span>
                    <span>{h.cost}</span>
                    <span className="ml-auto px-1.5 py-0.5 rounded" style={{ background: h.status === "completed" ? "#E8F5E9" : C.error + "18", color: h.status === "completed" ? C.success : C.error }}>{h.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}

function ProjectsScreen() {
  return (
    <ScreenFrame label="Screen — /projects (Project List)">
      <Sidebar active="Projects" />
      <div className="flex-1 flex flex-col">
        <TopBar title="Projects" actions={<Btn primary>+ New Project</Btn>} />
        <div className="p-4 space-y-3 overflow-auto">
          {[
            { name: "Vela Core", goal: "Build the autonomous agent orchestration platform MVP", tasks: 12, done: 4, agents: 3, status: "active" },
            { name: "Research Hub", goal: "Continuous research into AI frameworks, protocols, and best practices", tasks: 5, done: 2, agents: 1, status: "active" },
            { name: "Documentation", goal: "Write and maintain user-facing docs and developer guides", tasks: 3, done: 1, agents: 1, status: "active" },
          ].map(p => (
            <div key={p.name} className="rounded-lg p-4 flex items-start gap-4" style={{ background: "#fff", border: `1px solid ${C.stone[200]}` }}>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold" style={{ color: C.stone[800] }}>{p.name}</p>
                  <Badge bg="#E8F5E9" fg={C.success}>{p.status}</Badge>
                </div>
                <p className="text-xs mb-3" style={{ color: C.stone[500] }}>{p.goal}</p>
                <div className="flex gap-4 text-[10px] font-mono" style={{ color: C.stone[400] }}>
                  <span>{p.tasks} tasks ({p.done} done)</span>
                  <span>{p.agents} agents</span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: C.stone[100] }}>
                  <div className="h-full rounded-full" style={{ width: `${(p.done / p.tasks) * 100}%`, background: C.amber[400] }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ScreenFrame>
  );
}

function SkillsScreen() {
  return (
    <ScreenFrame label="Screen — /skills (Skills Editor)">
      <Sidebar active="Skills" />
      <div className="flex-1 flex flex-col">
        <TopBar title="Skills" actions={<Btn primary>+ New Skill</Btn>} />
        <div className="flex flex-1 overflow-hidden">
          {/* Skill list */}
          <div className="w-52 shrink-0 border-r p-3 overflow-auto" style={{ borderColor: C.stone[100] }}>
            <p className="text-[9px] font-mono uppercase tracking-wider mb-2 px-1" style={{ color: C.stone[400] }}>Global</p>
            {["orchestration-patterns","heartbeat-spec","code-conventions"].map((s,i) => (
              <div key={s} className="px-2.5 py-1.5 rounded-md text-[11px] mb-0.5 cursor-pointer" style={{ background: i === 0 ? C.amber[50] : "transparent", color: i === 0 ? C.amber[700] : C.stone[600], border: i === 0 ? `1px solid ${C.amber[200]}` : "1px solid transparent" }}>{s}.md</div>
            ))}
            <p className="text-[9px] font-mono uppercase tracking-wider mb-2 mt-4 px-1" style={{ color: C.stone[400] }}>Vela Core</p>
            {["api-design","db-patterns","testing-strategy"].map(s => (
              <div key={s} className="px-2.5 py-1.5 rounded-md text-[11px] mb-0.5 cursor-pointer" style={{ color: C.stone[600] }}>{s}.md</div>
            ))}
          </div>
          {/* Editor + Preview split */}
          <div className="flex-1 flex">
            <div className="flex-1 p-4 border-r" style={{ borderColor: C.stone[100] }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono" style={{ color: C.stone[400] }}>Edit</span>
                <Badge bg={C.amber[50]} fg={C.amber[600]}>Global</Badge>
              </div>
              <div className="rounded-md p-3 text-[11px] font-mono leading-relaxed h-full" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}`, color: C.stone[600] }}>
                {"# Orchestration Patterns\n\n## Stateless Agents\nAgents receive context, do work,\nreturn results. All state in\nPostgres.\n\n## Atomic Checkout\nUse row-level locks to prevent\nduplicate task pickup.\n\n## Event Sourcing\nNever update task records in\nplace. Append immutable events."}
              </div>
            </div>
            <div className="flex-1 p-4">
              <span className="text-[10px] font-mono mb-2 block" style={{ color: C.stone[400] }}>Preview</span>
              <div className="text-[11px] leading-relaxed" style={{ color: C.stone[600] }}>
                <p className="text-sm font-bold mb-2" style={{ color: C.stone[800], fontFamily: "Syne, system-ui" }}>Orchestration Patterns</p>
                <p className="font-semibold mt-2 mb-1" style={{ color: C.stone[700] }}>Stateless Agents</p>
                <p>Agents receive context, do work, return results. All state in Postgres.</p>
                <p className="font-semibold mt-2 mb-1" style={{ color: C.stone[700] }}>Atomic Checkout</p>
                <p>Use row-level locks to prevent duplicate task pickup.</p>
                <p className="font-semibold mt-2 mb-1" style={{ color: C.stone[700] }}>Event Sourcing</p>
                <p>Never update task records in place. Append immutable events.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}

function SchedulerScreen() {
  return (
    <ScreenFrame label="Screen — /scheduler (Heartbeat Overview)">
      <Sidebar active="Scheduler" />
      <div className="flex-1 flex flex-col">
        <TopBar title="Scheduler" actions={<Btn>⟳ Run All Now</Btn>} />
        <div className="p-4 overflow-auto">
          <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${C.stone[200]}` }}>
            {/* Header */}
            <div className="grid grid-cols-7 gap-2 px-4 py-2 text-[9px] font-mono uppercase tracking-wider" style={{ background: C.stone[50], color: C.stone[400] }}>
              <span>Agent</span><span>Schedule</span><span>Next run</span><span>Last run</span><span>Status</span><span>Enabled</span><span></span>
            </div>
            {[
              { name: "Lead Engineer", cron: "*/15 * * * *", next: "2:30 PM", last: "2:15 PM", status: "completed", enabled: true },
              { name: "Engineer", cron: "*/15 * * * *", next: "2:30 PM", last: "2:15 PM", status: "completed", enabled: true },
              { name: "Researcher", cron: "*/30 * * * *", next: "2:30 PM", last: "2:00 PM", status: "completed", enabled: true },
              { name: "Writer", cron: "0 */2 * * *", next: "4:00 PM", last: "2:00 PM", status: "completed", enabled: true },
              { name: "Junior Dev", cron: "*/30 * * * *", next: "—", last: "1:30 PM", status: "budget exceeded", enabled: false },
              { name: "Analyst", cron: "0 9 * * *", next: "—", last: "9:00 AM", status: "completed", enabled: false },
            ].map((a, i) => (
              <div key={i} className="grid grid-cols-7 gap-2 items-center px-4 py-2 text-[10px] font-mono border-t" style={{ borderColor: C.stone[100], color: C.stone[500] }}>
                <span style={{ color: C.stone[700] }}>{a.name}</span>
                <span>{a.cron}</span>
                <span>{a.next}</span>
                <span>{a.last}</span>
                <span><Badge bg={a.status === "completed" ? "#E8F5E9" : C.error + "18"} fg={a.status === "completed" ? C.success : C.error}>{a.status}</Badge></span>
                <span><div className="w-7 h-4 rounded-full relative" style={{ background: a.enabled ? C.amber[400] : C.stone[200] }}><div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all" style={{ left: a.enabled ? 14 : 2 }} /></div></span>
                <span><Btn small>Run Now</Btn></span>
              </div>
            ))}
          </div>
          {/* Recent heartbeats */}
          <p className="text-[10px] font-mono uppercase tracking-wider mt-6 mb-2" style={{ color: C.stone[400] }}>Recent heartbeats (all agents)</p>
          <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${C.stone[200]}` }}>
            {[
              { time: "2:15:03 PM", agent: "Lead Engineer", tasks: 1, cost: "$0.14", dur: "8.2s" },
              { time: "2:15:01 PM", agent: "Engineer", tasks: 1, cost: "$0.08", dur: "4.1s" },
              { time: "2:00:02 PM", agent: "Researcher", tasks: 1, cost: "$0.06", dur: "3.8s" },
              { time: "2:00:01 PM", agent: "Writer", tasks: 1, cost: "$0.00", dur: "2.1s" },
              { time: "2:00:00 PM", agent: "Lead Engineer", tasks: 1, cost: "$0.18", dur: "12.4s" },
            ].map((h, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-1.5 text-[10px] font-mono border-t" style={{ borderColor: C.stone[100], color: C.stone[500] }}>
                <span style={{ color: C.stone[700] }}>{h.time}</span>
                <span>{h.agent}</span>
                <span>{h.tasks} tasks</span>
                <span>{h.cost}</span>
                <span>{h.dur}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}

function ActivityScreen() {
  return (
    <ScreenFrame label="Screen — /activity (Global Activity Feed)">
      <Sidebar active="Activity" />
      <div className="flex-1 flex flex-col">
        <TopBar title="Activity" actions={<><Badge bg={C.stone[100]} fg={C.stone[500]}>All Agents</Badge><Badge bg={C.stone[100]} fg={C.stone[500]}>All Types</Badge><Badge bg={C.stone[100]} fg={C.stone[500]}>Today</Badge></>} />
        <div className="flex-1 p-5 overflow-auto">
          <div className="space-y-0">
            <EventRow type="heartbeat_end" time="2:15 PM" agent="Lead Engineer" content="Heartbeat completed: 1 task, 4,821 tokens, $0.14" />
            <EventRow type="status_change" time="2:16 PM" content="'Implement heartbeat loop' → review" />
            <EventRow type="budget_warning" time="2:16 PM" content="Lead Engineer at 82% budget ($41.00 / $50.00)" />
            <EventRow type="delegation" time="2:15 PM" agent="Lead Engineer" content="Created subtask 'Write unit tests for checkout' → Engineer" />
            <EventRow type="tool_call" time="2:15 PM" content="Lead Engineer → create_subtask (auto-approved)" />
            <EventRow type="heartbeat_end" time="2:15 PM" agent="Engineer" content="Heartbeat completed: 1 task, 2,340 tokens, $0.08" />
            <EventRow type="message" time="2:14 PM" agent="Researcher" content="Completed comparison of pgvector vs Pinecone. Recommending pgvector for simplicity." />
            <EventRow type="heartbeat_start" time="2:00 PM" agent="Lead Engineer" content="Heartbeat started" />
            <EventRow type="heartbeat_start" time="2:00 PM" agent="Researcher" content="Heartbeat started" />
            <EventRow type="loop_detected" time="1:15 PM" agent="Junior Dev" content="Loop detected: search_docs called 3x with identical params. Agent paused." />
            <EventRow type="error" time="1:15 PM" content="Junior Dev task 'Fix CSS layout' → blocked (loop detected)" />
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}

function SettingsScreen() {
  return (
    <ScreenFrame label="Screen — /settings">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar title="Settings" />
        <div className="flex-1 p-5 overflow-auto space-y-6">
          {/* Ollama Connection */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: C.stone[400] }}>Ollama Connection</p>
            <div className="rounded-lg p-4 space-y-3" style={{ background: "#fff", border: `1px solid ${C.stone[200]}` }}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: C.success }} />
                <span className="text-xs font-medium" style={{ color: C.success }}>Connected</span>
                <span className="text-[10px] font-mono ml-2" style={{ color: C.stone[400] }}>https://ollama.example.trycloudflare.com</span>
              </div>
              <div className="flex gap-2">
                <input type="text" placeholder="Tunnel URL" className="flex-1 text-[11px] px-3 py-1.5 rounded-md" style={{ border: `1px solid ${C.stone[200]}` }} readOnly defaultValue="https://ollama.example.trycloudflare.com" />
                <Btn>Test</Btn><Btn>Save</Btn>
              </div>
            </div>
          </div>
          {/* Model configs */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: C.stone[400] }}>Model Configuration</p>
            <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${C.stone[200]}` }}>
              <div className="grid grid-cols-6 gap-2 px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider" style={{ background: C.stone[50], color: C.stone[400] }}>
                <span>Name</span><span>Provider</span><span>Model ID</span><span>Tier</span><span>Cost/1M in</span><span>Status</span>
              </div>
              {[
                { name: "Claude Sonnet 4", provider: "anthropic", model: "claude-sonnet-4-*", tier: "standard", cost: "$3.00", available: true },
                { name: "Claude Haiku 4.5", provider: "anthropic", model: "claude-haiku-4-5-*", tier: "fast", cost: "$0.80", available: true },
                { name: "Qwen3 Coder", provider: "ollama", model: "qwen3-coder-next", tier: "standard", cost: "$0.00", available: true },
                { name: "Qwen3 8B", provider: "ollama", model: "qwen3:8b", tier: "fast", cost: "$0.00", available: true },
              ].map((m, i) => (
                <div key={i} className="grid grid-cols-6 gap-2 items-center px-3 py-2 text-[10px] font-mono border-t" style={{ borderColor: C.stone[100], color: C.stone[500] }}>
                  <span style={{ color: C.stone[700] }}>{m.name}</span>
                  <span>{m.provider}</span>
                  <span className="text-[9px]">{m.model}</span>
                  <span><Badge bg={m.tier === "standard" ? C.amber[50] : C.stone[100]} fg={m.tier === "standard" ? C.amber[600] : C.stone[500]}>{m.tier}</Badge></span>
                  <span>{m.cost}</span>
                  <span><span className="w-1.5 h-1.5 rounded-full inline-block mr-1" style={{ background: m.available ? C.success : C.error }} />{m.available ? "available" : "offline"}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Budget defaults */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: C.stone[400] }}>Budget Defaults</p>
            <div className="rounded-lg p-4 flex items-center gap-4" style={{ background: "#fff", border: `1px solid ${C.stone[200]}` }}>
              <div><p className="text-[10px] font-mono" style={{ color: C.stone[400] }}>Default monthly budget</p><input type="text" defaultValue="$25.00" className="text-sm font-mono mt-0.5 px-2 py-1 rounded-md w-28" style={{ border: `1px solid ${C.stone[200]}` }} readOnly /></div>
              <div><p className="text-[10px] font-mono" style={{ color: C.stone[400] }}>Warning threshold</p><input type="text" defaultValue="80%" className="text-sm font-mono mt-0.5 px-2 py-1 rounded-md w-20" style={{ border: `1px solid ${C.stone[200]}` }} readOnly /></div>
            </div>
          </div>
          {/* Danger zone */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: C.error }}>Danger Zone</p>
            <div className="rounded-lg p-4 flex items-center gap-3" style={{ background: "#FEF2F2", border: `1px solid #FECACA` }}>
              <div className="flex-1"><p className="text-xs font-medium" style={{ color: C.stone[800] }}>Reset all agent budgets</p><p className="text-[10px]" style={{ color: C.stone[500] }}>Sets budget_used to $0 for all agents</p></div>
              <button className="text-[11px] font-mono px-2.5 py-1 rounded-md" style={{ background: C.error, color: "#fff" }}>Reset Budgets</button>
            </div>
          </div>
        </div>
      </div>
    </ScreenFrame>
  );
}

// ─── Component Catalog ───────────────────────────────────────────
function ComponentCatalog() {
  return (
    <div className="space-y-6">
      <Sub title="Status badges">
        <div className="flex flex-wrap gap-2">
          {[
            ["backlog", C.stone[200], C.stone[600]],["open", C.info+"22", C.info],["in_progress", C.amber[100], C.amber[700]],
            ["review", C.purple+"22", C.purple],["waiting_for_human", C.warning+"22", C.warning],
            ["blocked", C.error+"22", C.error],["done", "#E8F5E9", C.success],["cancelled", C.stone[100], C.stone[400]],
          ].map(([s,bg,fg])=><Badge key={s} bg={bg} fg={fg}>{s.replace(/_/g," ")}</Badge>)}
        </div>
      </Sub>
      <Sub title="Priority badges">
        <div className="flex gap-2">
          {[["low",C.stone[100],C.stone[500]],["medium",C.info+"22",C.info],["high",C.amber[100],C.amber[700]],["urgent",C.error+"22",C.error]].map(([p,bg,fg])=><Badge key={p} bg={bg} fg={fg}>{p}</Badge>)}
        </div>
      </Sub>
      <Sub title="Agent statuses">
        <div className="flex gap-2">
          {[["active","#E8F5E9",C.success],["paused",C.stone[100],C.stone[500]],["budget_exceeded",C.error+"22",C.error]].map(([s,bg,fg])=><Badge key={s} bg={bg} fg={fg}>{s.replace(/_/g," ")}</Badge>)}
        </div>
      </Sub>
      <Sub title="Event types">
        <div className="flex flex-wrap gap-1.5">
          {["status_change","message","tool_call","model_call","delegation","budget_warning","budget_exceeded","heartbeat_start","heartbeat_end","error","loop_detected","assignment"].map(e=>
            <span key={e} className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}`, color: C.stone[500] }}>{e}</span>
          )}
        </div>
      </Sub>
      <Sub title="Budget bar variants">
        <div className="space-y-3 max-w-xs">
          <BudgetBar used={8.2} total={30} /><BudgetBar used={18} total={25} /><BudgetBar used={41} total={50} /><BudgetBar used={15} total={15} />
        </div>
      </Sub>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────
export default function VelaUISpec() {
  const [activeTab, setActiveTab] = useState("screens");
  return (
    <div className="min-h-screen" style={{ background: "#fff", color: C.stone[900], fontFamily: "Instrument Sans, system-ui, sans-serif" }}>
      <header className="pt-16 pb-10 px-6 border-b" style={{ borderColor: C.stone[100] }}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-5"><div className="w-5 h-px" style={{ background: C.amber[400] }} /><span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: C.amber[500] }}>UI Design Specification</span></div>
          <h1 className="text-4xl font-extrabold tracking-tight" style={{ fontFamily: "Syne, system-ui", lineHeight: 1.1 }}>Vela<span style={{ color: C.amber[400] }}>.</span> <span className="text-xl font-bold" style={{ color: C.stone[400] }}>UI Spec</span></h1>
          <p className="text-sm mt-3 leading-relaxed" style={{ color: C.stone[500], maxWidth: 540 }}>Screen mockups, component patterns, state systems, responsive rules, and implementation notes for the Vela MVP.</p>
          <div className="flex gap-1 mt-6 p-1 rounded-lg" style={{ background: C.stone[100] }}>
            {[["screens","Screens"],["components","Components"],["spec","Spec"]].map(([id,label])=>(
              <button key={id} onClick={()=>setActiveTab(id)} className="px-4 py-2 text-sm rounded-md transition-all" style={{ background: activeTab===id?"#fff":"transparent", color: activeTab===id?C.stone[900]:C.stone[500], fontWeight: activeTab===id?500:400, boxShadow: activeTab===id?"0 1px 2px rgba(0,0,0,0.05)":"none" }}>{label}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {activeTab === "screens" && (
          <div className="space-y-0">
            <Section num="01" title="Screen Map">
              <p className="text-sm mb-3" style={{ color: C.stone[600] }}>Every major screen in the Vela MVP, fully mocked with real data patterns. Click the tabs above to also see the component library and technical spec.</p>
              <Box accent>
                <strong style={{ color: C.amber[700] }}>7 screens total:</strong> Task Board (kanban), Task Detail (event thread), Agent Registry (cards), Agent Detail (config + heartbeat history), Projects, Skills Editor (split-pane), Scheduler Overview, Activity Feed, Settings. Login page is a simple password form — not mocked.
              </Box>
            </Section>
            <TaskBoardScreen />
            <TaskDetailScreen />
            <AgentsListScreen />
            <AgentDetailScreen />
            <ProjectsScreen />
            <SkillsScreen />
            <SchedulerScreen />
            <ActivityScreen />
            <SettingsScreen />
          </div>
        )}

        {activeTab === "components" && (
          <Section num="02" title="Component Library">
            <p className="text-sm mb-3" style={{ color: C.stone[600] }}>Reusable patterns across the app. All components use the brand token system — amber accent, warm stone neutrals, mono for machine content.</p>
            <ComponentCatalog />
          </Section>
        )}

        {activeTab === "spec" && (
          <div className="space-y-0">
            <Section num="03" title="Design Direction">
              <Sub title="Surface classification">
                <Box>This is a <strong>workspace + dashboard hybrid</strong>. The primary job is monitoring and reviewing autonomous agent work. Navigation is destination-based (sidebar). Detail views use split-pane for context + detail. Dense tables for comparison (scheduler, settings). Cards for bounded objects (agents, projects).</Box>
              </Sub>
              <Sub title="AI posture">
                <Box accent><strong style={{ color: C.amber[700] }}>Supervised automation.</strong> Agents work autonomously on heartbeat schedules. The UI surfaces activity and decisions for review — not as chat, but as a structured event timeline. Human intervention is an explicit state transition (waiting_for_human → in_progress), not a conversation.</Box>
              </Sub>
              <Sub title="Density">
                <p className="text-sm" style={{ color: C.stone[600] }}>Balanced. Show useful information without scrolling, but never at the expense of scanability. Tables for comparison (scheduler, heartbeat log, model config). Cards for bounded objects (agents, projects). Kanban for spatial task status. Event timeline for chronological audit.</p>
              </Sub>
            </Section>

            <Section num="04" title="Responsive Rules">
              <div className="space-y-3">
                {[
                  ["Desktop (1024px+)", "Sidebar always visible (220px). Kanban in full columns. Task detail in split-pane. Tables at full width."],
                  ["Tablet (640–1024px)", "Sidebar collapses to icon rail (48px). Kanban shows 3 columns, horizontal scroll. Detail views full-width. Tables scroll horizontally."],
                  ["Mobile (<640px)", "Sidebar → bottom tab bar (5 items). Kanban → list view sorted by status. Detail → drill-in page. Tables → stacked record cards."],
                ].map(([bp, desc]) => (
                  <div key={bp} className="rounded-lg p-4" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}>
                    <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: C.amber[500] }}>{bp}</span>
                    <p className="mt-1 text-sm" style={{ color: C.stone[600] }}>{desc}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section num="05" title="State Matrix">
              <p className="text-sm mb-3" style={{ color: C.stone[600] }}>Every meaningful state that needs explicit design treatment.</p>
              <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${C.stone[200]}` }}>
                {[
                  ["Empty — first run", "No projects, agents, or tasks. Centered onboarding prompt: 'Create your first project to get started.'"],
                  ["Empty — after filters", "Show active filter tokens + 'No tasks match these filters' + clear filters button."],
                  ["Loading", "Skeleton placeholders matching card/row dimensions. No spinners on page-level loads."],
                  ["Heartbeat running", "Pulsing amber dot next to agent name. Event stream updates via SSE."],
                  ["Budget warning (80%)", "Amber warning badge on agent card. Event logged. Toast notification."],
                  ["Budget exceeded", "Agent card goes red. Status changes to budget_exceeded. All tasks unassigned."],
                  ["Loop detected", "Agent paused. Task blocked with red error event. User notification."],
                  ["Ollama offline", "Yellow indicator in sidebar footer. Agent cards show fallback model. Settings shows disconnected."],
                  ["Waiting for human", "Task badge pulses. Appears in approval queue banner. Input field active."],
                  ["Error", "Red event in thread. Agent continues if recoverable, blocks task if not."],
                ].map(([state, desc]) => (
                  <div key={state} className="flex gap-3 px-4 py-2.5 text-[11px] border-t" style={{ borderColor: C.stone[100] }}>
                    <span className="font-mono shrink-0 w-40" style={{ color: C.stone[700] }}>{state}</span>
                    <span style={{ color: C.stone[500] }}>{desc}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section num="06" title="Implementation Tokens">
              <Sub title="shadcn/ui CSS variable mapping">
                <div className="font-mono text-[11px] space-y-0.5 p-4 rounded-lg" style={{ background: C.stone[950], color: C.stone[300] }}>
                  <p style={{ color: C.stone[500] }}>/* Light mode */</p>
                  <p>--background: 40 20% 100%;  <span style={{ color: C.stone[600] }}>/* #FFFFFF */</span></p>
                  <p>--foreground: 40 7% 9%;     <span style={{ color: C.stone[600] }}>/* Stone 900 */</span></p>
                  <p>--primary: 36 91% 55%;      <span style={{ color: C.stone[600] }}>/* Amber 400 */</span></p>
                  <p>--primary-foreground: 0 0% 100%;</p>
                  <p>--muted: 40 12% 96%;        <span style={{ color: C.stone[600] }}>/* Stone 50 */</span></p>
                  <p>--muted-foreground: 42 9% 39%;<span style={{ color: C.stone[600] }}> /* Stone 500 */</span></p>
                  <p>--border: 45 12% 82%;       <span style={{ color: C.stone[600] }}>/* Stone 200 */</span></p>
                  <p>--ring: 36 91% 55%;         <span style={{ color: C.stone[600] }}>/* Amber 400 */</span></p>
                  <p style={{ color: C.stone[500], marginTop: 8 }}>/* Dark mode */</p>
                  <p>--background: 60 3% 6%;     <span style={{ color: C.stone[600] }}>/* #111110 */</span></p>
                  <p>--foreground: 40 12% 90%;   <span style={{ color: C.stone[600] }}>/* Stone 100 */</span></p>
                  <p>--muted: 30 4% 10%;         <span style={{ color: C.stone[600] }}>/* #1A1918 */</span></p>
                  <p>--border: 45 5% 17%;        <span style={{ color: C.stone[600] }}>/* #2E2D2A */</span></p>
                </div>
              </Sub>
              <Sub title="Design tokens">
                <div className="text-xs space-y-1.5" style={{ color: C.stone[500] }}>
                  <p><strong style={{ color: C.stone[700] }}>Borders:</strong> 1px solid. Stone 200 (light) / Dark border (dark). Never 2px.</p>
                  <p><strong style={{ color: C.stone[700] }}>Border radius:</strong> 6px small (badges, pills). 8px medium (cards, inputs). 12px large (panels, modals).</p>
                  <p><strong style={{ color: C.stone[700] }}>Shadows:</strong> None except dropdown menus: <code className="font-mono text-[10px]" style={{ color: C.amber[600] }}>0 4px 12px rgba(0,0,0,0.08)</code></p>
                  <p><strong style={{ color: C.stone[700] }}>Focus rings:</strong> 2px amber-400, 2px offset. All interactive elements.</p>
                  <p><strong style={{ color: C.stone[700] }}>Transitions:</strong> 150ms ease for hovers. No entrance animations in MVP.</p>
                  <p><strong style={{ color: C.stone[700] }}>Icons:</strong> Lucide React. 16px default, 20px for nav. Stroke width 1.5.</p>
                  <p><strong style={{ color: C.stone[700] }}>Spacing:</strong> 4px base unit. 8/12/16/20/24/32/40/48px scale.</p>
                  <p><strong style={{ color: C.stone[700] }}>Sidebar:</strong> 220px desktop, 48px tablet rail, bottom bar mobile.</p>
                  <p><strong style={{ color: C.stone[700] }}>Max content width:</strong> 1200px. Task board fills available width.</p>
                </div>
              </Sub>
            </Section>
          </div>
        )}
      </main>

      <footer className="py-8 text-center"><span className="font-mono text-[10px]" style={{ color: C.stone[300] }}>Vela UI Design Specification · v1.0 · April 2026</span></footer>
    </div>
  );
}
