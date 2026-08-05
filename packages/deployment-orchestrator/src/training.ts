/**
 * EPIC 11 — Training & Enablement. Registries for administrator, customer, partner, and government-
 * operator training, certification paths, and knowledge assessments. Training assets are REPRESENTED
 * until created — a course is registered as a plan (<code>published:false</code>); no completed course,
 * certification, or assessment score for a real person is fabricated.
 */
import { randomId } from '@neuropause/cloud-core';
import { TRAINING_TRACKS, type TrainingTrack } from './constants';
import type { DeploymentOrchestratorGovernance } from './governance';

export interface Course {
  id: string;
  title: string;
  track: TrainingTrack;
  published: false;
}
export interface CertificationPath {
  id: string;
  name: string;
  courseIds: string[];
}
export interface Assessment {
  id: string;
  courseId: string;
  questionCount: number;
}

export class TrainingEnablement {
  private readonly courses = new Map<string, Course>();
  private readonly paths = new Map<string, CertificationPath>();
  private readonly assessments = new Map<string, Assessment>();

  constructor(
    private readonly gov: DeploymentOrchestratorGovernance,
    private readonly operator: string,
  ) {}

  tracks(): readonly TrainingTrack[] {
    return TRAINING_TRACKS;
  }

  async registerCourse(input: { title: string; track: TrainingTrack }): Promise<Course> {
    const course: Course = { id: randomId('course'), title: input.title, track: input.track, published: false };
    this.courses.set(course.id, course);
    await this.gov.record({ operator: this.operator, organization: '_training', environment: 'enablement', version: '1.0.0', epic: 'E11', operation: 'register-course', targetId: course.id, evidence: 'business-data-pending', decision: `${input.track} (represented)` });
    return course;
  }

  async addCertificationPath(input: { name: string; courseIds: string[] }): Promise<CertificationPath> {
    const path: CertificationPath = { id: randomId('cert'), name: input.name, courseIds: input.courseIds };
    this.paths.set(path.id, path);
    await this.gov.record({ operator: this.operator, organization: '_training', environment: 'enablement', version: '1.0.0', epic: 'E11', operation: 'add-certification-path', targetId: path.id, evidence: 'live-verified', decision: `${input.courseIds.length} courses` });
    return path;
  }

  async addAssessment(input: { courseId: string; questionCount: number }): Promise<Assessment> {
    const assessment: Assessment = { id: randomId('assess'), courseId: input.courseId, questionCount: input.questionCount };
    this.assessments.set(assessment.id, assessment);
    await this.gov.record({ operator: this.operator, organization: '_training', environment: 'enablement', version: '1.0.0', epic: 'E11', operation: 'add-assessment', targetId: assessment.id, evidence: 'live-verified', decision: `${input.questionCount} questions` });
    return assessment;
  }

  courseCount(): number {
    return this.courses.size;
  }
  pathCount(): number {
    return this.paths.size;
  }
}
