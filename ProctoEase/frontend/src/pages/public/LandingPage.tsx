import { Link } from "react-router-dom"
import {
  Shield,
  Lock,
  Eye,
  Monitor,
  BarChart3,
  Users,
  ArrowRight,
  CheckCircle,
} from "lucide-react"

const features = [
  {
    icon: Shield,
    title: "AI-Assisted Proctoring",
    desc: "Real-time face detection and anomaly monitoring powered by computer vision.",
  },
  {
    icon: Lock,
    title: "Browser Lockdown",
    desc: "Prevents tab switching, copy-paste, and unauthorised keyboard shortcuts.",
  },
  {
    icon: Eye,
    title: "Identity Verification",
    desc: "Webcam-based identity checks before each exam session.",
  },
  {
    icon: Monitor,
    title: "Real-Time Monitoring",
    desc: "Live violation tracking with configurable warning thresholds.",
  },
  {
    icon: BarChart3,
    title: "Automated Reporting",
    desc: "Risk scores, attempt analytics, and exportable exam reports.",
  },
  {
    icon: Users,
    title: "Multi-Tenant Support",
    desc: "Isolated data per organisation with row-level security.",
  },
]

const stats = [
  { value: "99%", label: "Uptime" },
  { value: "< 2s", label: "Verification" },
  { value: "256-bit", label: "Encryption" },
  { value: "RBAC", label: "Access Control" },
]

const steps = [
  { num: "01", title: "Register", desc: "Create your organisation and set up accounts." },
  { num: "02", title: "Create or Take Exams", desc: "Recruiters author exams; Candidates take them." },
  { num: "03", title: "Get Results", desc: "AI-assisted proctoring reports and analytics." },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background" style={{ caretColor: "transparent" }}>
      {/* Navbar */}
      <nav className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <img src="/image.png" alt="ProctoEase Logo" className="h-8 w-8" />
            <span><span className="text-primary">Procto</span><span className="text-foreground">Ease</span></span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition"
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary-700 transition"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section
        className="max-w-6xl mx-auto px-6 py-24 text-center select-none"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="inline-flex items-center gap-2 bg-primary-50 text-primary text-xs font-medium px-3 py-1 rounded-full mb-6">
          <CheckCircle className="h-3 w-3" />
          Trusted AI-Powered Assessment Platform
        </div>
        <h1
          className="text-5xl font-extrabold tracking-tight leading-tight max-w-3xl mx-auto cursor-default select-none"
          style={{ caretColor: "transparent", userSelect: "none" }}
        >
          Smart Online Assessment &{" "}
          <span className="text-primary">AI-Assisted Proctoring</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Secure, scalable, multi-tenant examination platform with real-time proctoring,
          browser lockdown, and automated violation detection.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            to="/register"
            className="px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary-700 transition flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            Get Started <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#features"
            className="px-6 py-3 border border-border rounded-lg font-medium text-muted-foreground hover:bg-muted transition"
          >
            Learn More
          </a>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border bg-muted/50">
        <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-bold text-primary">{s.value}</p>
              <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-4">
          Everything You Need
        </h2>
        <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
          Enterprise-grade features built for secure online assessments.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="group p-6 rounded-xl border border-border bg-card hover:shadow-lg hover:-translate-y-1 transition-all duration-200"
            >
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-muted/30 border-y border-border">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step) => (
              <div key={step.num} className="text-center">
                <div className="text-4xl font-extrabold text-primary/20 mb-3">
                  {step.num}
                </div>
                <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © 2026 ProctoEase. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-foreground transition-colors">Terms</a>
            <a href="mailto:support@proctoease.com" className="hover:text-foreground transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
