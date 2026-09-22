export interface LessonContract {
  lesson_id: string;
  title: string;
  description: string;
  estimated_minutes: number;
  difficulty: string;
  prerequisites: string[];
  learning_objective: { id: string; text: string };
  measurable_outcomes: { id: string; text: string }[];
  instructional_content: { section_id: string; heading: string; text: string }[];
  practice: {
    instructions: string[];
    starter_material: Record<string, unknown>;
    hints: string[];
    submission_type: string;
  };
  checkpoint: {
    assessment_id: string;
    questions: { question_id: string; type: string; prompt: string; options?: { id: string; label: string }[] }[];
  };
  competency_ids: string[];
  progression: { remediation_rule: { next_action: string; lesson_section: string } };
}

export interface CurriculumLesson {
  activity_id: string;
  module_id: string;
  lesson_code: string;
  domain_code: string;
  course_code: string;
  version: number;
  status: "draft" | "published" | "retired";
  contract: LessonContract;
}

export interface CurriculumVideo {
  video_id: string;
  source_url: string;
  embed_url: string;
  candidate_title: string;
  health_status: "needs_review" | "healthy" | "unavailable";
  duration_seconds: number | null;
  transcript: string | null;
}

export interface LessonVideoMapping {
  video_id: string | null;
  required: boolean;
  threshold: number;
  start_seconds: number | null;
  end_seconds: number | null;
  relevance_verified_at: string | null;
}

export interface CurriculumSearch {
  total: number;
  catalog_total: number;
  domains: number;
  published: number;
  lessons: { activity_id: string; lesson_code: string; domain_code: string; version: number; status: string; title: string; objective: string }[];
}
