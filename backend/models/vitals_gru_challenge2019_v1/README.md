# `vitals_gru_challenge2019_v1`

Reviewed deploy artifact for the Medi-Matrix six-Vitals auxiliary risk signal.

- Source: PhysioNet/Computing in Cardiology Challenge 2019 v1.0.0
- Training run: `33848975780`, commit `ddbc7246a3a733ebac747fe9931e62b57a027738`
- Artifact ID: `9928005532`
- Model SHA-256: `182cebac9eae5bce456a904f00aee6e1d7650f3432e170783e437eab82eb202f`
- Inputs: `hr`, `bpSys`, `bpDia`, `resp`, `temp`, `spo2`
- Target: official PhysioNet `SepsisLabel`, used directly with no additional shift
- Split: patient-level stratified 70/15/15, seed 42
- Test Challenge Utility: `0.34512958980235814`
- Test AUROC: `0.7946005008323214`
- Test AUPRC: `0.09500058131187976`
- Validation-selected threshold: `0.5996291004197073`

This is a competition/research decision-support signal, **not a diagnosis or a clinically validated model**. The runtime verifies the model checksum before loading it and does not synthesize ARDS or shock probabilities from this checkpoint.
