"""Canonical violation catalog, scoring defaults, and guideline metadata."""

from __future__ import annotations


BASE_VIOLATIONS: tuple[str, ...] = (
    "tab_switch",
    "fullscreen_exit",
    "keyboard_block",
    "copy_paste",
    "right_click",
    "browser_devtools",
    "inactivity",
    "multiple_faces",
    "no_face",
    "audio_anomaly",
    "custom",
)

DERIVED_VIOLATIONS: tuple[str, ...] = (
    "rapid_tab_switching",
    "suspicious_activity_burst",
    "bulk_paste_detected",
    "impossible_answer_speed",
    "face_inconsistency",
    "periodic_check",
    "gaze_away",
    "head_turned",
    "phone_detected",
    "unauthorized_object",
)

CANONICAL_VIOLATION_TYPES: tuple[str, ...] = BASE_VIOLATIONS + DERIVED_VIOLATIONS


DEFAULT_RISK_WEIGHTS: dict[str, float] = {
    "tab_switch": 0.3,
    "fullscreen_exit": 0.3,
    "keyboard_block": 0.25,
    "copy_paste": 0.4,
    "right_click": 0.2,
    "browser_devtools": 0.6,
    "inactivity": 0.2,
    "no_face": 0.6,
    "multiple_faces": 0.8,
    "audio_anomaly": 0.4,
    "custom": 0.1,
    "rapid_tab_switching": 0.5,
    "suspicious_activity_burst": 0.6,
    "bulk_paste_detected": 0.5,
    "impossible_answer_speed": 0.4,
    "face_inconsistency": 0.5,
    "periodic_check": 0.05,
    "gaze_away": 0.3,
    "head_turned": 0.25,
    "phone_detected": 0.9,
    "unauthorized_object": 0.8,
}


VIOLATION_GUIDELINES: dict[str, dict[str, str]] = {
    "tab_switch": {
        "severity": "medium",
        "description": "User switches browser tab during exam",
        "impact": "Possible attempt to access external resources",
        "recommended_action": "Monitor candidate behavior for repeated switches",
    },
    "fullscreen_exit": {
        "severity": "medium",
        "description": "User exits fullscreen mode",
        "impact": "Reduced exam environment control",
        "recommended_action": "Prompt return to fullscreen and monitor recurrence",
    },
    "keyboard_block": {
        "severity": "medium",
        "description": "Blocked keyboard shortcut was attempted",
        "impact": "May indicate intent to copy, inspect, or navigate away",
        "recommended_action": "Review key pattern and correlate with other events",
    },
    "copy_paste": {
        "severity": "high",
        "description": "Copy or paste action detected during exam",
        "impact": "Potential data exfiltration or answer injection",
        "recommended_action": "Investigate context and frequency immediately",
    },
    "right_click": {
        "severity": "low",
        "description": "Right-click/context menu interaction detected",
        "impact": "Can indicate exploratory bypass behavior",
        "recommended_action": "Monitor if repeated with other suspicious signals",
    },
    "browser_devtools": {
        "severity": "high",
        "description": "Browser developer tools likely opened",
        "impact": "Possible inspection/manipulation of exam client",
        "recommended_action": "Flag attempt for manual review",
    },
    "inactivity": {
        "severity": "low",
        "description": "No user activity for configured duration",
        "impact": "May indicate candidate disengagement or off-screen behavior",
        "recommended_action": "Monitor and correlate with face/audio anomalies",
    },
    "multiple_faces": {
        "severity": "critical",
        "description": "Multiple faces detected in candidate frame",
        "impact": "High risk of impersonation or external assistance",
        "recommended_action": "Escalate for immediate manual investigation",
    },
    "no_face": {
        "severity": "high",
        "description": "Candidate face not detected",
        "impact": "Reduced identity assurance",
        "recommended_action": "Review duration/frequency and request explanation",
    },
    "audio_anomaly": {
        "severity": "medium",
        "description": "Suspicious audio pattern detected",
        "impact": "Possible conversation or external assistance",
        "recommended_action": "Correlate with timeline and other proctoring events",
    },
    "custom": {
        "severity": "low",
        "description": "Custom or fallback proctoring event",
        "impact": "Generic signal; interpretation depends on detail payload",
        "recommended_action": "Inspect detail payload before escalation",
    },
    "rapid_tab_switching": {
        "severity": "high",
        "description": "More than 3 tab switches within 10 seconds",
        "impact": "Strong pattern of context switching during assessment",
        "recommended_action": "Flag as suspicious pattern and review immediately",
    },
    "suspicious_activity_burst": {
        "severity": "critical",
        "description": "More than 5 violations within 30 seconds",
        "impact": "Concentrated suspicious activity cluster",
        "recommended_action": "Escalate attempt for priority review",
    },
    "bulk_paste_detected": {
        "severity": "high",
        "description": "Large paste payload detected (>50 chars)",
        "impact": "Potential external answer/code insertion",
        "recommended_action": "Review pasted content context in timeline",
    },
    "impossible_answer_speed": {
        "severity": "medium",
        "description": "Submission speed appears too fast for answered question mix",
        "impact": "May indicate pre-known answers or automation assistance",
        "recommended_action": "Cross-check with attempt timeline and response quality",
    },
    "face_inconsistency": {
        "severity": "high",
        "description": "Face count changed abruptly (e.g., one face to none or multiple)",
        "impact": "Possible identity instability or external intervention",
        "recommended_action": "Review nearby snapshots and timeline events",
    },
    "periodic_check": {
        "severity": "low",
        "description": "Periodic monitoring snapshot/checkpoint event",
        "impact": "Supports continuity checks over long attempts",
        "recommended_action": "Use for contextual evidence in investigations",
    },
    "gaze_away": {
        "severity": "medium",
        "description": "Candidate gaze appears directed away from the screen",
        "impact": "May indicate off-screen consultation or disengagement",
        "recommended_action": "Review duration and recurrence around answer activity",
    },
    "head_turned": {
        "severity": "medium",
        "description": "Candidate head orientation appears turned away from screen",
        "impact": "Reduced confidence in continuous attention",
        "recommended_action": "Correlate with nearby snapshots and other violations",
    },
    "phone_detected": {
        "severity": "critical",
        "description": "Mobile phone-like object detected in camera view",
        "impact": "High risk of unauthorized external aid",
        "recommended_action": "Escalate attempt for immediate manual review",
    },
    "unauthorized_object": {
        "severity": "high",
        "description": "Potential unauthorized object detected in camera view",
        "impact": "Possible access to external resources",
        "recommended_action": "Inspect object evidence and timeline context",
    },
}
