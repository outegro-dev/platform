package domain

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
)

// StateVersion is the only state format this build reads and writes.
const StateVersion = 1

// ErrStateVersion reports a state document written in another format.
var ErrStateVersion = errors.New("unsupported state version")

// State is what the watchdog remembers between passes.
type State struct {
	// Version is always StateVersion when encoded.
	Version int `json:"version"`
	// DigestDay is the UTC day (YYYYMMDD) of the last delivered daily digest.
	DigestDay string `json:"digestDay,omitempty"`
	// Entries maps a finding key to what is known about that problem.
	Entries map[string]Entry `json:"entries"`
}

// Entry tracks one problem. Times are unix seconds; Notified == 0 means the
// owner has not been told yet.
type Entry struct {
	Since    int64  `json:"since"`
	Notified int64  `json:"notified"`
	Message  string `json:"message"`
}

// NewState returns an empty state of the current version.
func NewState() State {
	return State{Version: StateVersion, Entries: map[string]Entry{}}
}

// Clone returns a deep copy, so callers can change it without touching s.
func (s State) Clone() State {
	out := s
	out.Entries = maps.Clone(s.Entries)
	if out.Entries == nil {
		out.Entries = map[string]Entry{}
	}
	return out
}

// EncodeState renders the state as JSON. Map keys are sorted by
// encoding/json, so the output is stable between runs.
func EncodeState(s State) ([]byte, error) {
	s.Version = StateVersion
	if s.Entries == nil {
		s.Entries = map[string]Entry{}
	}
	data, err := json.Marshal(s)
	if err != nil {
		return nil, fmt.Errorf("encode state: %w", err)
	}
	return data, nil
}

// DecodeState parses a JSON state document and checks its version.
func DecodeState(data []byte) (State, error) {
	var s State
	if err := json.Unmarshal(data, &s); err != nil {
		return State{}, fmt.Errorf("decode state: %w", err)
	}
	if s.Version != StateVersion {
		return State{}, fmt.Errorf("decode state: version %d: %w", s.Version, ErrStateVersion)
	}
	if s.Entries == nil {
		s.Entries = map[string]Entry{}
	}
	return s, nil
}
