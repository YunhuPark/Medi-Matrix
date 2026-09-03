# Medi-Matrix Product Scenario: Inter-hospital Transfer Decision Support

## 1. Problem definition

Medi-Matrix does **not** assume that an ambulance crew manually uploads MRI and CSV files immediately after a patient collapses.

The target scenario is a **secondary transfer decision inside an emergency-care workflow**:

1. A patient arrives at a local emergency department.
2. CT/MRI and bedside Vitals are obtained as part of normal care.
3. A serious brain-lesion context is identified, while Vitals are monitored over time.
4. The current hospital cannot provide all required resources for definitive treatment.
5. The care team must identify a higher-level hospital that can actually accept the patient and provide the required resources.

The product question is therefore:

> **Given the patient's imaging context and changing physiologic state, what resources are required now, and which transfer candidates satisfy those requirements?**

Medi-Matrix is an MVP for that decision-support step.

---

## 2. Why the system is useful

A simple hospital directory answers:

> "What resources does this hospital have?"

Medi-Matrix first creates the other half of the problem:

> "What resources does this patient appear to require at this point in the workflow?"

Golden-Time then combines the patient-side Context with publicly available emergency-resource information to re-rank candidate hospitals.

```text
Patient imaging + Vitals
        ↓
Medi-Matrix
Patient / transfer Context
        ↓
Required capabilities
        ↓
Golden-Time + E-Gen resources
        ↓
Transfer candidate re-ranking
```

This is decision support, not autonomous diagnosis, transfer authorization, or a claim that the first-ranked hospital will accept the patient.

---

## 3. Real deployment data flow

The public prototype uses uploaded synthetic `.nii/.nii.gz` and `.csv` files because it has no access to a hospital network.

That upload UI is a **test adapter**, not the intended final workflow.

A real deployment would require integration adapters such as:

```text
PACS / imaging system
        └── CT/MRI/DICOM

EMR / bedside monitor integration
        └── Vitals / observations

              ↓
        Hospital Encounter
              ↓
        Medi-Matrix Case
```

The current non-PHI `Case ID` is an internal MVP identifier. A hospital deployment would map a hospital encounter to the internal Case through a protected integration layer rather than exposing patient names, MRNs, or other PHI in URLs or logs.

---

## 4. MVP scenario used for the competition

### Initial state: imaging context available

A patient in a local emergency department has a brain-lesion imaging context. The public demo visualizes that context as a 3D mesh and lesion volume.

### YELLOW state

Vitals indicate a warning-level deterioration in the demo policy.

For the current brain-case prototype, transfer search emphasizes imaging and operative capability such as:

- CT/MRI capability
- operating-room capability

These are prototype search criteria and are **not claimed to be a complete clinical transfer guideline**.

### RED state

Vitals worsen enough that the demo Decision Engine classifies the encounter as RED/systemic deterioration.

The transfer Context expands to include critical-care requirements in addition to imaging/operative capability, such as:

- emergency-department availability
- ICU availability
- CT/MRI capability
- operating-room capability

The important product behavior is that **the transfer-search criteria change when the patient's state changes**.

---

## 5. What is real and what is simulated

### Public Medi-Matrix deployment

- Patient input: synthetic MRI/Vitals
- MRI segmentation in demo mode: deterministic synthetic mask
- Vitals risk engine: deterministic demo risk-pattern engine
- Triage thresholds: demo policy, not clinical thresholds

### Research validation

IMST-Mamba is a separate time-series research model for early sepsis prediction and was evaluated on the public PhysioNet Sepsis Challenge 2019 ICU dataset. The current public Medi-Matrix deployment must not imply that IMST-Mamba is already performing live inference unless the real preprocessing/checkpoint path has actually been connected and verified.

### Hospital-resource side

Golden-Time uses public emergency-resource information from E-Gen and patient Context to re-rank hospital candidates. It does not guarantee acceptance or replace direct transfer coordination.

---

## 6. Product boundaries

Medi-Matrix currently demonstrates:

- one Case linking imaging Context and Vitals Context,
- changing patient state over time,
- explainable demo Triage,
- required-resource changes by state,
- hand-off into hospital candidate search.

It does not currently demonstrate:

- clinical diagnosis,
- a validated multimodal medical model,
- automatic PACS/EMR integration,
- same-patient real-world multimodal validation,
- autonomous transfer decisions,
- confirmed receiving-hospital acceptance.

---

## 7. Next validation milestones

1. Bind MRI, Vitals, Triage, and transfer search to one Case ID end-to-end.
2. Add one-click synthetic Demo Case execution for judges.
3. Connect the actual validated IMST-Mamba inference path only after checkpoint and preprocessing compatibility are verified.
4. Validate the vision pipeline on public brain MRI data such as BraTS.
5. Add a PACS/EMR integration adapter contract and a mock hospital Encounter interface.
6. Ultimately validate on same-patient imaging + physiologic data before making multimodal clinical-performance claims.
