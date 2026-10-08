import pytest
from unittest.mock import MagicMock
from main import extract_activities_from_transcript, is_entry_duplicate

def test_extraction_mapping_tie():
    user_kras = [
        {"name": "Stakeholder Management", "description": "Manage partners and mentors"},
        {"name": "Platform Architecture", "description": "System design and APIs"}
    ]
    # Test the required sentence mapping
    transcript = "Today I coordinated with the TiE team regarding mentor availability and followed up on pending queries."
    activities = extract_activities_from_transcript(transcript, user_kras)
    assert len(activities) >= 1
    act = activities[0]
    assert act.kra_name == "Stakeholder Management"
    assert "tie" in act.mapping_reason.lower() or "stakeholder" in act.mapping_reason.lower() or "mentor" in act.mapping_reason.lower()
    assert act.confidence_level in ["High", "Medium"]

def test_unmapped_work_detection():
    user_kras = [
        {"name": "Platform Architecture", "description": "System design and APIs"}
    ]
    transcript = "I organized my personal kitchen pantry and watched a documentary."
    activities = extract_activities_from_transcript(transcript, user_kras)
    assert len(activities) >= 1
    assert activities[0].kra_name == "Unmapped"

def test_duplicate_avoidance():
    existing = ["Coordinated mentor availability with TiE team"]
    assert is_entry_duplicate("Coordinated mentor availability with TiE team", existing) is True
    assert is_entry_duplicate("Refactored authentication middleware", existing) is False
