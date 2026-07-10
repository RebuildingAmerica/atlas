import type { DiscountSegment } from "../discount-segments";

export interface StudentVerificationData {
  schoolEmail: string;
  schoolName: string;
}

export interface IndependentJournalistVerificationData {
  portfolioUrl: string;
}

export interface GrassrootsNonprofitVerificationData {
  budget: string;
  einOrName: string;
}

export interface CivicTechVerificationData {
  mission: string;
  projectUrl: string;
}

export interface DiscountVerificationDataBySegment {
  civic_tech_worker: CivicTechVerificationData;
  grassroots_nonprofit: GrassrootsNonprofitVerificationData;
  independent_journalist: IndependentJournalistVerificationData;
  student: StudentVerificationData;
}

export type DiscountVerificationSubmission = {
  [Segment in DiscountSegment]: {
    data: DiscountVerificationDataBySegment[Segment];
    segment: Segment;
  };
}[DiscountSegment];

export interface DiscountVerificationRequestBody {
  data: DiscountVerificationSubmission["data"];
  organization_id: string;
  segment: DiscountVerificationSubmission["segment"];
  user_id: string;
}

interface BuildDiscountVerificationRequestBodyParams {
  organizationId: string;
  submission: DiscountVerificationSubmission;
  userId: string;
}

export function buildDiscountVerificationRequestBody({
  organizationId,
  submission,
  userId,
}: BuildDiscountVerificationRequestBodyParams): DiscountVerificationRequestBody {
  return {
    data: submission.data,
    organization_id: organizationId,
    segment: submission.segment,
    user_id: userId,
  };
}
