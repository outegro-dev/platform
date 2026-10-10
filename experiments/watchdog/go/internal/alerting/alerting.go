// Package alerting decides what to tell the owner. Plan compares the
// findings of this pass with the remembered state; Apply records which
// messages were actually delivered. Both are pure functions.
package alerting

import (
	"cmp"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

// Kind is the type of a message. Plan emits messages in the order the
// constants are declared.
type Kind string

// Message kinds.
const (
	Greeting  Kind = "greeting"
	Problem   Kind = "problem"
	Reminder  Kind = "reminder"
	Recovered Kind = "recovered"
	Digest    Kind = "digest"
)

const (
	// ReminderInterval is how often a problem that stays is repeated.
	ReminderInterval = 6 * time.Hour
	// DigestHourUTC is the UTC hour from which the daily digest is sent.
	DigestHourUTC = 7

	dayLayout = "20060102"
)

// Message texts. The emoji are written as escapes so the exact code points
// are visible: 👋 U+1F44B, 🔴 U+1F534, 🟠 U+1F7E0, 🟢 U+1F7E2, ☀️ U+2600 U+FE0F.
const (
	GreetingText    = "\U0001F44B outegro.dev watchdog is on duty: pods, nodes, disk, certificates, backups, Argo CD and health checks every 5 minutes."
	problemHeader   = "\U0001F534 outegro.dev: problem"
	reminderHeader  = "\U0001F7E0 outegro.dev: still failing"
	recoveredHeader = "\U0001F7E2 outegro.dev: recovered"
	digestHeader    = "☀️ outegro.dev daily: "
)

// Grace is how long a problem must last before it is reported. Deploys
// briefly make Argo CD applications and HTTP endpoints unhappy, and
// Prometheus restarts with them.
func Grace(key string) time.Duration {
	switch {
	case strings.HasPrefix(key, "argo:"):
		return 900 * time.Second
	case strings.HasPrefix(key, "http:"):
		return 240 * time.Second
	case key == "prom:api":
		return 900 * time.Second
	default:
		return 0
	}
}

// Message is one Telegram message.
type Message struct {
	Kind Kind
	Text string
	// keys are the findings this message is about: Apply marks them
	// notified (problem, reminder) or forgets them (recovered).
	keys []string
}

// Outcome is the result of Plan: the messages to send and what to remember
// once it is known which of them were delivered.
type Outcome struct {
	Messages []Message
	// Failing is the number of distinct findings in this pass.
	Failing int

	base  domain.State // the next state if nothing is delivered
	now   int64
	today string
}

// Plan decides what to send. prev is nil on the first run. It never
// modifies prev.
func Plan(prev *domain.State, findings []domain.Finding, facts domain.Facts, now time.Time) Outcome {
	nowUnix := now.Unix()
	today := now.UTC().Format(dayLayout)

	old := domain.NewState()
	if prev != nil {
		old = prev.Clone()
	}

	current := domain.Dedupe(findings)
	slices.SortStableFunc(current, func(a, b domain.Finding) int { return cmp.Compare(a.Key, b.Key) })

	base := domain.State{
		Version:   domain.StateVersion,
		DigestDay: old.DigestDay,
		Entries:   make(map[string]domain.Entry, len(current)),
	}
	var problems, reminders, recovered lines

	for _, f := range current {
		e, known := old.Entries[f.Key]
		if !known {
			e = domain.Entry{Since: nowUnix}
		}
		e.Message = f.Message
		if nowUnix-e.Since >= seconds(Grace(f.Key)) {
			switch {
			case e.Notified == 0:
				problems.add(f.Key, f.Message)
			case nowUnix-e.Notified >= seconds(ReminderInterval):
				reminders.add(f.Key, f.Message)
			}
		}
		base.Entries[f.Key] = e
	}

	for _, key := range slices.Sorted(maps.Keys(old.Entries)) {
		if _, still := base.Entries[key]; still {
			continue
		}
		e := old.Entries[key]
		if e.Notified == 0 {
			continue // never reported: forget it silently
		}
		recovered.add(key, e.Message)
		base.Entries[key] = e // kept until the recovery is delivered
	}

	var msgs []Message
	if prev == nil {
		msgs = append(msgs, Message{Kind: Greeting, Text: GreetingText})
	}
	msgs = problems.appendTo(msgs, Problem, problemHeader)
	msgs = reminders.appendTo(msgs, Reminder, reminderHeader)
	msgs = recovered.appendTo(msgs, Recovered, recoveredHeader)
	if now.UTC().Hour() >= DigestHourUTC && old.DigestDay != today {
		msgs = append(msgs, Message{Kind: Digest, Text: digestText(len(current), facts)})
	}

	return Outcome{Messages: msgs, Failing: len(current), base: base, now: nowUnix, today: today}
}

// Apply returns the state to save. delivered[i] tells whether
// o.Messages[i] was accepted; a missing entry counts as not delivered.
// Only delivered messages change notified, the recovered entries and
// digestDay, so a failed send is retried on the next pass.
func Apply(o Outcome, delivered []bool) domain.State {
	next := o.base.Clone()
	for i, m := range o.Messages {
		if i >= len(delivered) || !delivered[i] {
			continue
		}
		switch m.Kind {
		case Problem, Reminder:
			for _, k := range m.keys {
				e := next.Entries[k]
				e.Notified = o.now
				next.Entries[k] = e
			}
		case Recovered:
			for _, k := range m.keys {
				delete(next.Entries, k)
			}
		case Digest:
			next.DigestDay = o.today
		case Greeting:
			// Nothing to record: saving any state ends the first run.
		}
	}
	return next
}

// lines collects the bullet lines of one message and the keys behind them.
type lines struct {
	keys []string
	text strings.Builder
}

func (l *lines) add(key, message string) {
	l.keys = append(l.keys, key)
	l.text.WriteString("\n• ")
	l.text.WriteString(message)
}

func (l *lines) appendTo(msgs []Message, kind Kind, header string) []Message {
	if len(l.keys) == 0 {
		return msgs
	}
	return append(msgs, Message{Kind: kind, Text: header + l.text.String(), keys: l.keys})
}

func digestText(failing int, f domain.Facts) string {
	status := "All checks pass."
	if failing > 0 {
		status = fmt.Sprintf("Failing checks: %d.", failing)
	}
	return digestHeader + status +
		"\nPods running: " + orUnknown(f.PodsRunning) +
		"\nLast backup: " + orUnknown(f.BackupAgeHours) + " h ago" +
		"\nCertificate: " + orUnknown(f.CertDaysLeft) + " days left" +
		"\nDisk: " + orUnknown(f.DiskUsedPercent) + "% used"
}

func orUnknown(v *int) string {
	if v == nil {
		return "?"
	}
	return strconv.Itoa(*v)
}

func seconds(d time.Duration) int64 {
	return int64(d / time.Second)
}
