import { useState } from "react";

// ─── Design Tokens ───────────────────────────────────────────────
const C = {
  amber: { 50:"#FFF8ED",100:"#FEEFD6",200:"#FCD9A4",300:"#F9BD62",400:"#F5A623",500:"#E08F0D",600:"#B86F08",700:"#8A5009",800:"#5C360E",900:"#3D2409" },
  stone: { 0:"#FFFFFF",25:"#FAFAF8",50:"#F5F4F1",100:"#ECEAE4",200:"#D8D5CC",300:"#B8B4A8",400:"#8E897B",500:"#6B665A",600:"#4E4A40",700:"#3A3731",800:"#282622",900:"#1A1917",950:"#0F0E0D" },
  success:"#3D8B5C", warning:"#C27D1A", error:"#C4413A", info:"#4A7AB5",
  dark: { bg:"#111110", surface:"#1A1918", surface2:"#222120", border:"#2E2D2A" },
};

function Swatch({ hex, label, size = "md" }) {
  const [copied, setCopied] = useState(false);
  const light = ["#FFFFFF","#FAFAF8","#FFF8ED","#F5F4F1","#FEEFD6","#ECEAE4"].includes(hex);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(hex); setCopied(true); setTimeout(() => setCopied(false), 1000); }}
      className="group relative flex flex-col rounded-lg overflow-hidden cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98]"
      style={{ background: hex, minHeight: size === "lg" ? 72 : 52, padding: "8px 10px", border: light ? `1px solid ${C.stone[200]}` : "1px solid transparent" }}>
      <span className="text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: light ? C.stone[600] : "rgba(255,255,255,.85)" }}>{copied ? "Copied" : hex}</span>
      {label && <span className="mt-auto text-[10px] font-medium" style={{ color: light ? C.stone[500] : "rgba(255,255,255,.6)" }}>{label}</span>}
    </button>
  );
}

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
function Badge({ children, variant = "amber" }) { const bg = variant === "amber" ? C.amber[50] : C.stone[50]; const fg = variant === "amber" ? C.amber[700] : C.stone[600]; return <span className="inline-block text-[10px] font-mono tracking-wider uppercase px-2.5 py-0.5 rounded-full" style={{ background: bg, color: fg, border: `1px solid ${variant === "amber" ? C.amber[200] : C.stone[200]}` }}>{children}</span>; }

function VoiceCard({ is: a, not: b }) {
  return <div className="rounded-lg px-4 py-3 text-sm" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}><span className="font-medium" style={{ color: C.amber[600] }}>{a}</span><span style={{ color: C.stone[400] }}> but not </span><span style={{ color: C.stone[500] }}>{b}</span></div>;
}

function Axis({ left, right, val }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-right text-[10px] font-mono" style={{ color: C.stone[500] }}>{left}</span>
      <div className="flex-1 h-1.5 rounded-full relative" style={{ background: C.stone[100] }}>
        <div className="absolute top-1/2 w-3 h-3 rounded-full border-2" style={{ left: `${val * 10}%`, background: "#fff", borderColor: C.amber[400], transform: "translate(-50%,-50%)" }} />
      </div>
      <span className="w-20 text-[10px] font-mono" style={{ color: C.stone[500] }}>{right}</span>
    </div>
  );
}

export default function VelaBrandKit() {
  return (
    <div className="min-h-screen" style={{ background: "#fff", color: C.stone[900], fontFamily: "Instrument Sans, system-ui, sans-serif" }}>
      <header className="pt-16 pb-10 px-6 border-b" style={{ borderColor: C.stone[100] }}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 mb-5"><div className="w-5 h-px" style={{ background: C.amber[400] }} /><span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: C.amber[500] }}>Brand Identity Kit</span></div>
          <h1 className="text-4xl font-extrabold tracking-tight" style={{ fontFamily: "Syne, system-ui", lineHeight: 1.1 }}>Vela<span style={{ color: C.amber[400] }}>.</span></h1>
          <p className="text-sm mt-3 leading-relaxed" style={{ color: C.stone[500], maxWidth: 480 }}>Brand strategy, visual identity, color system, typography, and voice guidelines for the Vela agent orchestration platform.</p>
          <div className="flex gap-4 mt-5 font-mono text-[11px]" style={{ color: C.stone[400] }}><span>April 2026</span><span>v1.0</span><span>bystarnes</span></div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12 space-y-0">

        {/* 01 STRATEGY */}
        <Section num="01" title="Brand Strategy">
          <Sub title="Brand truth">
            <p className="text-sm leading-relaxed" style={{ color: C.stone[600] }}>Vela exists because autonomous agents shouldn't require constant supervision to be trustworthy. The best orchestration feels like a quiet observatory — always watching, never intruding, surfacing what matters only when it matters. Intelligence should be ambient, not theatrical.</p>
          </Sub>
          <Sub title="Positioning statement">
            <Box accent>For <strong>solo developers and technical operators</strong>, Vela is the <strong>self-hosted agent orchestration layer</strong> that gives you calm, auditable control over autonomous AI work — because you shouldn't have to babysit the things that are supposed to be working for you.</Box>
          </Sub>
          <Sub title="Brand archetypes">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg p-4" style={{ background: C.amber[50], border: `1px solid ${C.amber[200]}` }}><Badge>Primary</Badge><p className="mt-2 text-sm font-semibold" style={{ color: C.stone[800] }}>The Sage</p><p className="text-xs mt-1 leading-relaxed" style={{ color: C.stone[500] }}>Wisdom, understanding, truth-seeking. Observes patiently before acting. Values knowledge and clarity above speed.</p></div>
              <div className="rounded-lg p-4" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}><Badge variant="stone">Secondary</Badge><p className="mt-2 text-sm font-semibold" style={{ color: C.stone[800] }}>The Ruler</p><p className="text-xs mt-1 leading-relaxed" style={{ color: C.stone[500] }}>Control, order, responsibility. Creates structure from chaos. Ensures every part of the system is accountable.</p></div>
            </div>
          </Sub>
          <Sub title="Competitive white space">
            <p className="text-sm leading-relaxed" style={{ color: C.stone[600] }}>Most orchestration tools position as either "enterprise platform" (complex, team-oriented, cold blue branding) or "prototyping playground" (casual, colorful, dev-toy energy). Vela occupies uncrowded territory: <strong style={{ color: C.stone[800] }}>serious tool for a single operator</strong>. Warm but precise. Personal but professional.</p>
          </Sub>
          <Sub title="Voice attributes">
            <div className="grid grid-cols-2 gap-2">
              <VoiceCard is="Precise" not="clinical" />
              <VoiceCard is="Warm" not="casual" />
              <VoiceCard is="Confident" not="arrogant" />
              <VoiceCard is="Concise" not="terse" />
            </div>
            <div className="mt-3 text-xs leading-relaxed space-y-0.5" style={{ color: C.stone[500] }}>
              <p><strong style={{ color: C.stone[700] }}>Copy examples:</strong></p>
              <p>✓ "3 tasks completed. $0.42 spent. One decision needs your input."</p>
              <p>✗ "Great news! Your amazing agents crushed it today! 🎉"</p>
              <p className="mt-1">✓ "Agent paused — budget limit reached at $50.00."</p>
              <p>✗ "Oops! Looks like we ran out of budget. Try increasing the limit?"</p>
            </div>
          </Sub>
        </Section>

        {/* 02 VISUAL CONCEPT */}
        <Section num="02" title="Visual Concept">
          <Sub title="Core metaphor">
            <p className="text-sm leading-relaxed" style={{ color: C.stone[600] }}><strong style={{ color: C.stone[800] }}>Quiet observatory.</strong> Warm amber readings against calm surfaces, precise data, ambient alertness. Every visual element earns its space. The amber accent is candlelight in a quiet room: small, warm, and the only thing your eye is drawn to.</p>
            <p className="text-sm leading-relaxed mt-2" style={{ color: C.stone[600] }}>The name "Vela" — a constellation in the southern sky, the sails of the ship Argo — is a subtle nod to navigation and celestial observation. No star illustrations, no compass icons. Just the feeling of quiet guidance.</p>
          </Sub>
          <Sub title="Visual personality">
            <div className="space-y-2">
              <Axis left="Minimal" right="Maximal" val={3} />
              <Axis left="Cold" right="Warm" val={6} />
              <Axis left="Geometric" right="Organic" val={3} />
              <Axis left="Serious" right="Playful" val={2.5} />
              <Axis left="Classic" right="Contemporary" val={7} />
              <Axis left="Simple" right="Complex" val={4} />
            </div>
          </Sub>
          <Sub title="Design principles">
            <div className="grid grid-cols-2 gap-3">
              {[["Earned presence","Nothing on screen unless it has a reason. No decorative elements, filler cards, or placeholder charts."],["Amber restraint","The accent is powerful because it's rare. 10% amber, 90% neutrals. When amber appears, it means something."],["Typography as hierarchy","Weight and size differences do the work. No colored backgrounds or card borders needed to create structure."],["Mono for machines","JetBrains Mono for agent-generated content — timestamps, costs, event types. Instrument Sans for human content."]].map(([t,d])=>(
                <div key={t} className="rounded-lg p-3" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}><p className="text-xs font-semibold mb-1" style={{ color: C.stone[800] }}>{t}</p><p className="text-[11px] leading-relaxed" style={{ color: C.stone[500] }}>{d}</p></div>
              ))}
            </div>
          </Sub>
        </Section>

        {/* 03 COLOR */}
        <Section num="03" title="Color System">
          <Sub title="Primary — Amber">
            <p className="text-xs mb-3" style={{ color: C.stone[500] }}>Single accent color. Used for primary actions, active states, budget bars, and key focal points.</p>
            <div className="grid grid-cols-5 gap-2">{Object.entries(C.amber).map(([k,v])=><Swatch key={k} hex={v} label={k} />)}</div>
          </Sub>
          <Sub title="Neutrals — Warm stone">
            <p className="text-xs mb-3" style={{ color: C.stone[500] }}>Warm-tinted neutrals. The slight yellow undertone prevents the clinical feeling of standard gray scales.</p>
            <div className="grid grid-cols-7 gap-2">{Object.entries(C.stone).filter(([k])=>!["0","25"].includes(k)).map(([k,v])=><Swatch key={k} hex={v} label={k} />)}</div>
          </Sub>
          <Sub title="Semantic">
            <div className="grid grid-cols-4 gap-2"><Swatch hex={C.success} label="Success" /><Swatch hex={C.warning} label="Warning" /><Swatch hex={C.error} label="Error" /><Swatch hex={C.info} label="Info" /></div>
          </Sub>
          <Sub title="Dark mode surfaces">
            <div className="grid grid-cols-4 gap-2">{Object.entries(C.dark).map(([k,v])=><Swatch key={k} hex={v} label={k} size="lg" />)}</div>
          </Sub>
          <Sub title="Proportion">
            <Box accent><strong style={{ color: C.amber[700] }}>60-30-10:</strong> 60% stone neutrals (canvas), 30% darker stones (text, borders), 10% amber (actions, alerts). Never use amber for large surface fills.</Box>
          </Sub>
        </Section>

        {/* 04 TYPOGRAPHY */}
        <Section num="04" title="Typography">
          <Sub title="Type stack">
            <div className="space-y-4">
              <div className="rounded-lg p-5" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}><Badge>Display</Badge><p className="mt-3 text-[28px] font-bold tracking-tight" style={{ fontFamily: "Syne, system-ui" }}>Syne</p><p className="text-xs mt-2" style={{ color: C.stone[400] }}>700, 800. Page titles, section headers, navigation labels, metric numbers. Google Fonts: <code className="font-mono text-[11px]" style={{ color: C.amber[600] }}>Syne:wght@700;800</code></p></div>
              <div className="rounded-lg p-5" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}><Badge variant="stone">Body</Badge><p className="mt-3 text-lg">Instrument Sans</p><p className="text-xs mt-2" style={{ color: C.stone[400] }}>400, 500. Body text, descriptions, form labels. <code className="font-mono text-[11px]" style={{ color: C.amber[600] }}>Instrument+Sans:wght@400;500</code></p></div>
              <div className="rounded-lg p-5" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}><Badge variant="stone">Mono</Badge><p className="mt-3 font-mono text-sm">JetBrains Mono</p><p className="text-xs mt-2" style={{ color: C.stone[400] }}>400, 500. Costs, cron, timestamps, event types, status badges, code. <code className="font-mono text-[11px]" style={{ color: C.amber[600] }}>JetBrains+Mono:wght@400;500</code></p></div>
            </div>
          </Sub>
          <Sub title="Scale">
            <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.stone[200]}` }}>
              {[["Display","28–36px","Syne 800","Page titles"],["H2","22px","Syne 700","Section headers"],["H3","16px","Syne 600","Card titles"],["Body","14–15px","Instrument 400","Descriptions"],["Body Med","14px","Instrument 500","Emphasized, nav"],["Small","13px","Instrument 400","Table cells"],["Caption","11–12px","JetBrains 400","Badges, timestamps"],["Overline","10–11px","JetBrains 500","Eyebrows (uppercase)"]].map(([n,s,w,u])=>(
                <div key={n} className="grid grid-cols-4 gap-3 px-4 py-2 border-b text-[11px] font-mono" style={{ borderColor: C.stone[100], color: C.stone[500] }}><span style={{ color: C.stone[800] }}>{n}</span><span>{s}</span><span>{w}</span><span>{u}</span></div>
              ))}
            </div>
          </Sub>
        </Section>

        {/* 05 MESSAGING */}
        <Section num="05" title="Messaging">
          <Sub title="Tagline"><p className="text-2xl font-bold tracking-tight" style={{ fontFamily: "Syne, system-ui" }}>Orchestrate quietly.</p></Sub>
          <Sub title="Hierarchy">
            <div className="space-y-3 text-sm">
              <div className="rounded-lg p-4" style={{ background: C.amber[50], border: `1px solid ${C.amber[200]}` }}><span className="text-[10px] font-mono tracking-wider uppercase" style={{ color: C.amber[600] }}>Primary</span><p className="mt-1.5 font-medium" style={{ color: C.stone[800] }}>Self-hosted orchestration for autonomous AI agents. Control without micromanagement.</p></div>
              <div className="rounded-lg p-4" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}><span className="text-[10px] font-mono tracking-wider uppercase" style={{ color: C.stone[500] }}>Proof points</span><div className="mt-2 space-y-1" style={{ color: C.stone[600] }}><p>Append-only audit trail for every agent decision.</p><p>Atomic budget enforcement — no runaway costs.</p><p>Hybrid model routing with automatic fallback.</p></div></div>
              <div className="rounded-lg p-4" style={{ background: C.stone[50], border: `1px solid ${C.stone[200]}` }}><span className="text-[10px] font-mono tracking-wider uppercase" style={{ color: C.stone[500] }}>Elevator pitch</span><p className="mt-1.5" style={{ color: C.stone[600] }}>"Vela lets you manage a fleet of AI agents through a task board. They pick up work on a schedule, use your models, and report back. You review, approve, and control the budget. A team that works while you don't."</p></div>
            </div>
          </Sub>
          <Sub title="Brand story">
            <div className="text-sm leading-relaxed space-y-3" style={{ color: C.stone[600] }}>
              <p><strong style={{ color: C.stone[800] }}>Before:</strong> Managing multiple agents doing continuous work means building the same infrastructure every time. Frameworks are complex, platforms are opinionated, nothing is designed for a single developer who just wants things to work.</p>
              <p><strong style={{ color: C.stone[800] }}>Belief:</strong> Orchestration should be as calm as checking a dashboard. If you have to babysit your agents, they're not autonomous — they're just tools with extra steps.</p>
              <p><strong style={{ color: C.stone[800] }}>After:</strong> Define agents, assign tasks, set budgets, walk away. Agents work on heartbeat schedules, delegate to each other, surface only the decisions that need your judgment. Every action logged, every dollar tracked, every failure recoverable.</p>
            </div>
          </Sub>
        </Section>

        {/* 06 USAGE GUIDELINES */}
        <Section num="06" title="Usage Guidelines">
          <Sub title="Never">
            <div className="grid grid-cols-2 gap-2">{["Amber as large surface fill","Gradients or glass effects","Rounded-everything (max 12px radius)","Emoji in product UI","Exclamatory copy ('!' in product)","Pure gray instead of warm stone"].map(r=><div key={r} className="rounded-lg px-3 py-2 text-[11px]" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: C.error }}>{r}</div>)}</div>
          </Sub>
          <Sub title="Always">
            <div className="grid grid-cols-2 gap-2">{["Mono font for machine content","Amber sparingly — signals importance","Warm stone palette, never pure gray","Sentence case everywhere","4.5:1 contrast minimum","Lead with data, not adjectives"].map(r=><div key={r} className="rounded-lg px-3 py-2 text-[11px]" style={{ background: "#E8F5E9", border: "1px solid #C8E6C9", color: C.success }}>{r}</div>)}</div>
          </Sub>
        </Section>
      </main>
      <footer className="py-8 text-center"><span className="font-mono text-[10px]" style={{ color: C.stone[300] }}>Vela Brand Identity Kit · v1.0 · April 2026</span></footer>
    </div>
  );
}
