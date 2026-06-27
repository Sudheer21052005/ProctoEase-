import { useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  examCreateSchema,
  type ExamCreateFormValues,
} from "@/lib/validations/exam.schema"
import { useCreateExam, useCreateExamViaIngestion } from "@/hooks/useExams"
import { toast } from "sonner"
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  Check,
  Upload,
  FileText,
  Code,
  Pencil,
} from "lucide-react"
import { formatDuration } from "@/lib/utils"
import type { AxiosError } from "axios"
import type { ExamIngestionMode, ExamIngestionPreview } from "@/api/exam.api"

const STEPS = ["Exam Details", "Review & Create"]
const MODE_OPTIONS: Array<{
  value: ExamIngestionMode
  label: string
  icon: typeof Pencil
}> = [
  { value: "manual", label: "Manual", icon: Pencil },
  { value: "pdf", label: "Upload PDF", icon: FileText },
  { value: "json", label: "Upload JSON", icon: Code },
]

export default function ExamCreate() {
  const [searchParams] = useSearchParams()
  const initialMode = (searchParams.get("mode") || "manual") as ExamIngestionMode
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<ExamIngestionMode>(
    MODE_OPTIONS.some((m) => m.value === initialMode) ? initialMode : "manual"
  )
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [jsonText, setJsonText] = useState(`{
  "title": "Imported Frontend Assessment",
  "description": "Generated from JSON upload",
  "duration_minutes": 60,
  "is_published": false,
  "questions": [
    {
      "type": "mcq",
      "question": "Which hook is used for local state in React?",
      "options": ["useEffect", "useState", "useMemo", "useRef"],
      "correct_answer": "B",
      "points": 2
    }
  ]
}`)
  const [preview, setPreview] = useState<ExamIngestionPreview | null>(null)

  const navigate = useNavigate()
  const createExam = useCreateExam()
  const createViaIngestion = useCreateExamViaIngestion()

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ExamCreateFormValues>({
    resolver: zodResolver(examCreateSchema),
    defaultValues: {
      title: "",
      description: "",
      duration_minutes: 60,
      start_time: "",
      end_time: "",
      is_published: false,
    },
  })

  const formValues = watch()

  const ingestLoading = createViaIngestion.isPending

  const onSubmit = (data: ExamCreateFormValues) => {
    createExam.mutate({
      ...data,
      start_time: data.start_time ? new Date(data.start_time).toISOString() : null,
      end_time: data.end_time ? new Date(data.end_time).toISOString() : null,
    }, {
      onSuccess: () => {
        toast.success("Exam created successfully!")
        navigate("/recruiter/exams")
      },
      onError: (err) => {
        const axiosErr = err as AxiosError<{ detail: string }>
        toast.error(axiosErr.response?.data?.detail || "Failed to create exam")
      },
    })
  }

  const handlePreview = async () => {
    try {
      if (mode === "pdf") {
        if (!uploadFile) {
          toast.error("Please choose a PDF file")
          return
        }
        const form = new FormData()
        form.append("mode", "pdf")
        form.append("preview_only", "true")
        form.append("file", uploadFile)
        const res = await createViaIngestion.mutateAsync({ form })
        setPreview(res.preview)
        toast.success("Preview generated")
        return
      }

      if (mode === "json") {
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(jsonText) as Record<string, unknown>
        } catch {
          toast.error("JSON is invalid")
          return
        }

        const res = await createViaIngestion.mutateAsync({
          json: {
            mode: "json",
            payload,
            preview_only: true,
          },
        })
        setPreview(res.preview)
        toast.success("Preview generated")
      }
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: string }>
      toast.error(axiosErr.response?.data?.detail || "Failed to parse upload")
    }
  }

  const handleCreateFromUpload = async () => {
    try {
      if (mode === "pdf") {
        if (!uploadFile) {
          toast.error("Please choose a PDF file")
          return
        }
        const form = new FormData()
        form.append("mode", "pdf")
        form.append("preview_only", "false")
        form.append("file", uploadFile)
        const res = await createViaIngestion.mutateAsync({ form })
        if (!res.created) {
          toast.error("Exam was not created")
          return
        }
        toast.success("Exam created successfully!")
        navigate("/recruiter/exams")
        return
      }

      if (mode === "json") {
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(jsonText) as Record<string, unknown>
        } catch {
          toast.error("JSON is invalid")
          return
        }

        const res = await createViaIngestion.mutateAsync({
          json: {
            mode: "json",
            payload,
            preview_only: false,
          },
        })
        if (!res.created) {
          toast.error("Exam was not created")
          return
        }
        toast.success("Exam created successfully!")
        navigate("/recruiter/exams")
      }
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: string }>
      toast.error(axiosErr.response?.data?.detail || "Failed to create exam from upload")
    }
  }

  const resetPreview = () => setPreview(null)

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6 rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map((item) => {
            const Icon = item.icon
            const active = mode === item.value
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setMode(item.value)
                  setStep(0)
                  resetPreview()
                }}
                className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      {mode !== "manual" && (
        <div className="space-y-5 rounded-xl border border-border bg-card p-6 mb-6">
          <h2 className="text-xl font-semibold">
            {mode === "pdf" ? "Create Exam from PDF" : "Create Exam from JSON"}
          </h2>

          {mode === "pdf" ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium">Upload PDF (max 5MB)</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null
                  setUploadFile(file)
                  resetPreview()
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm font-medium">JSON Payload</label>
              <textarea
                rows={14}
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  resetPreview()
                }}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-xs font-mono"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handlePreview}
              disabled={ingestLoading}
              className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition disabled:opacity-50"
            >
              {ingestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Parse & Preview
            </button>

            <button
              type="button"
              onClick={handleCreateFromUpload}
              disabled={ingestLoading || !preview}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {ingestLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create from Upload
            </button>
          </div>

          {preview && (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <h3 className="font-semibold mb-2">Preview</h3>
              <div className="grid sm:grid-cols-2 gap-2 text-sm mb-3">
                <p><span className="text-muted-foreground">Title:</span> {preview.title}</p>
                <p><span className="text-muted-foreground">Duration:</span> {preview.duration_minutes} minutes</p>
                <p><span className="text-muted-foreground">Published:</span> {preview.is_published ? "Yes" : "No"}</p>
                <p><span className="text-muted-foreground">Questions:</span> {preview.question_count}</p>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {preview.questions.map((q, i) => (
                  <div key={`${q.question_text}-${i}`} className="rounded border border-border bg-background p-2 text-xs">
                    <p className="font-medium">Q{i + 1}: {q.question_text}</p>
                    <p className="text-muted-foreground">
                      type: {q.question_type} | points: {q.points} | options: {q.options_count}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === "manual" && (
        <div className="flex items-center gap-4 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  i <= step
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`text-sm font-medium ${
                  i <= step ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <div className="w-12 h-px bg-border mx-2" />
              )}
            </div>
          ))}
        </div>
      )}

      {mode === "manual" && (
        <form onSubmit={handleSubmit(onSubmit)}>
        {/* Step 1: Details */}
        {step === 0 && (
          <div className="space-y-5 rounded-xl border border-border bg-card p-6">
            <h2 className="text-xl font-semibold mb-2">Exam Details</h2>

            <div>
              <label htmlFor="title" className="block text-sm font-medium mb-1.5">
                Title *
              </label>
              <input
                id="title"
                type="text"
                placeholder="e.g. JavaScript Fundamentals Test"
                {...register("title")}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              {errors.title && (
                <p className="text-xs text-danger mt-1">{errors.title.message}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium mb-1.5"
              >
                Description
              </label>
              <textarea
                id="description"
                rows={4}
                placeholder="Brief description of the exam…"
                {...register("description")}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {(formValues.description || "").length} / 2000 chars
              </p>
            </div>

            <div>
              <label
                htmlFor="duration_minutes"
                className="block text-sm font-medium mb-1.5"
              >
                Duration *
              </label>
              <div className="flex items-center gap-4">
                <input
                  id="duration_minutes"
                  type="range"
                  min={5}
                  max={480}
                  step={5}
                  {...register("duration_minutes")}
                  className="flex-1 accent-primary"
                />
                <span className="text-sm font-mono w-24 text-right">
                  {formatDuration(formValues.duration_minutes)}
                </span>
              </div>
              {errors.duration_minutes && (
                <p className="text-xs text-danger mt-1">
                  {errors.duration_minutes.message}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <input
                id="is_published"
                type="checkbox"
                {...register("is_published")}
                className="h-4 w-4 accent-primary rounded"
              />
              <label htmlFor="is_published" className="text-sm font-medium">
                Publish immediately
              </label>
              <span className="text-xs text-muted-foreground">
                (candidates will see it right away)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="start_time" className="block text-sm font-medium mb-1.5">
                  Start Time (optional)
                </label>
                <input
                  id="start_time"
                  type="datetime-local"
                  {...register("start_time")}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm"
                />
              </div>

              <div>
                <label htmlFor="end_time" className="block text-sm font-medium mb-1.5">
                  End Time (optional)
                </label>
                <input
                  id="end_time"
                  type="datetime-local"
                  {...register("end_time")}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm"
                />
                {errors.end_time && (
                  <p className="text-xs text-danger mt-1">{errors.end_time.message}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-700 transition"
              >
                Review
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Review */}
        {step === 1 && (
          <div className="space-y-5 rounded-xl border border-border bg-card p-6">
            <h2 className="text-xl font-semibold mb-2">Review & Create</h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Title</span>
                <span className="font-medium">{formValues.title || "—"}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Description</span>
                <span className="font-medium max-w-xs text-right truncate">
                  {formValues.description || "None"}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">
                  {formatDuration(formValues.duration_minutes)}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Start Time</span>
                <span className="font-medium">{formValues.start_time || "Immediate"}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">End Time</span>
                <span className="font-medium">{formValues.end_time || "No end time"}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">Status</span>
                <span
                  className={`font-medium ${
                    formValues.is_published ? "text-success" : "text-warning"
                  }`}
                >
                  {formValues.is_published ? "Published" : "Draft"}
                </span>
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="submit"
                disabled={createExam.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
              >
                {createExam.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Create Exam
              </button>
            </div>
          </div>
        )}
        </form>
      )}
    </div>
  )
}
