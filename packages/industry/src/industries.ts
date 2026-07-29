/**
 * The built-in catalog of 20 vertical solution packs. Each is a declaration that composes on the
 * Wave 8 business domains — none duplicates core business logic.
 */
import { defineHealthcare, defineMedicalDevice, definePharmaceutical } from './healthcareIndustries';
import { defineBanking, defineInsurance } from './financialIndustries';
import { defineRetail, defineHospitality, defineRealEstate, defineMedia, defineProfessionalServices } from './commerceIndustries';
import { defineManufacturing, defineLogistics, defineConstruction, defineEnergy, defineAutomotive, defineAviation, defineAgriculture } from './industrialIndustries';
import { defineGovernment, defineEducation, defineTelecom } from './publicIndustries';
import type { IndustrySolution } from './types';

export function allIndustrySolutions(): IndustrySolution[] {
  return [
    defineHealthcare(),
    defineMedicalDevice(),
    definePharmaceutical(),
    defineBanking(),
    defineInsurance(),
    defineRetail(),
    defineHospitality(),
    defineRealEstate(),
    defineMedia(),
    defineProfessionalServices(),
    defineManufacturing(),
    defineLogistics(),
    defineConstruction(),
    defineEnergy(),
    defineAutomotive(),
    defineAviation(),
    defineAgriculture(),
    defineGovernment(),
    defineEducation(),
    defineTelecom(),
  ];
}
