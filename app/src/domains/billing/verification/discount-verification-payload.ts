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
