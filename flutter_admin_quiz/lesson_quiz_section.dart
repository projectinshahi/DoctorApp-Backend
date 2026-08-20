import 'package:flutter/material.dart';

import '../models/quiz_models.dart';

/// The quiz block on the Lesson detail screen.
///
/// Render rules, in order:
///   quiz != null            -> the quiz card (with warnings if it can't serve)
///   quiz == null, type quiz -> "no quiz linked" empty state
///   any other lesson type   -> nothing at all (SizedBox.shrink)
///
/// Drop this straight under the lock/subscription banner.
class LessonQuizSection extends StatelessWidget {
  final String lessonType; // video | text | quiz
  final LessonQuiz? quiz;
  final VoidCallback onPreview;
  final VoidCallback onLink;
  final VoidCallback? onUnlink;

  const LessonQuizSection({
    super.key,
    required this.lessonType,
    required this.quiz,
    required this.onPreview,
    required this.onLink,
    this.onUnlink,
  });

  @override
  Widget build(BuildContext context) {
    if (quiz == null) {
      // A quiz lesson with nothing linked can't serve anything — prompt for it.
      // Anything else simply has no quiz section.
      return lessonType == 'quiz' ? _EmptyState(onLink: onLink) : const SizedBox.shrink();
    }
    return _QuizCard(quiz: quiz!, onPreview: onPreview, onChange: onLink, onUnlink: onUnlink);
  }
}

class _EmptyState extends StatelessWidget {
  final VoidCallback onLink;
  const _EmptyState({required this.onLink});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Icon(Icons.quiz_outlined, size: 28),
            const SizedBox(width: 12),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('No quiz linked', style: TextStyle(fontWeight: FontWeight.w600)),
                  SizedBox(height: 2),
                  Text(
                    'This lesson is a quiz but has no questions to serve yet.',
                    style: TextStyle(fontSize: 12),
                  ),
                ],
              ),
            ),
            TextButton(onPressed: onLink, child: const Text('Link a quiz')),
          ],
        ),
      ),
    );
  }
}

class _QuizCard extends StatelessWidget {
  final LessonQuiz quiz;
  final VoidCallback onPreview;
  final VoidCallback onChange;
  final VoidCallback? onUnlink;

  const _QuizCard({
    required this.quiz,
    required this.onPreview,
    required this.onChange,
    this.onUnlink,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.quiz, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    quiz.title,
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                if (onUnlink != null)
                  IconButton(
                    tooltip: 'Unlink quiz',
                    icon: const Icon(Icons.link_off, size: 20),
                    onPressed: onUnlink,
                  ),
              ],
            ),
            const SizedBox(height: 10),

            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (quiz.examTag != null) _Chip(label: quiz.examTag!.toUpperCase()),
                _Chip(label: 'Subject ${quiz.subjectId}'),
                _Chip(label: 'Topic ${quiz.topicId}'),
              ],
            ),
            const SizedBox(height: 12),

            Text(
              quiz.questionCount == null
                  ? 'Serving all ${quiz.availableQuestions} matching questions'
                  : 'Serving ${quiz.servedQuestions} of ${quiz.availableQuestions} available '
                      '(asks for ${quiz.questionCount})',
              style: theme.textTheme.bodySmall,
            ),

            // Three things stop a quiz lesson working. Each is silent at save
            // time and only shows up when a student opens the lesson, so they
            // are surfaced here instead.
            if (quiz.isEmpty)
              const _Warning(
                text: 'No questions match this quiz. Students will see an empty quiz.',
                severity: _Severity.error,
              ),
            if (!quiz.isEmpty && quiz.isUnderfilled)
              _Warning(
                text: 'Only ${quiz.availableQuestions} question(s) available, '
                    'but this quiz asks for ${quiz.questionCount}.',
                severity: _Severity.warning,
              ),
            if (!quiz.isActive)
              const _Warning(
                text: 'This quiz is inactive. The lesson will fail to load for students.',
                severity: _Severity.error,
              ),

            const SizedBox(height: 12),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: onPreview,
                  icon: const Icon(Icons.visibility_outlined, size: 18),
                  label: const Text('Preview questions'),
                ),
                const SizedBox(width: 8),
                TextButton(onPressed: onChange, child: const Text('Change')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

enum _Severity { warning, error }

class _Warning extends StatelessWidget {
  final String text;
  final _Severity severity;
  const _Warning({required this.text, required this.severity});

  @override
  Widget build(BuildContext context) {
    final isError = severity == _Severity.error;
    final color = isError ? Colors.red.shade700 : Colors.orange.shade800;

    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(isError ? Icons.error_outline : Icons.warning_amber_outlined, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text, style: TextStyle(fontSize: 12, color: color)),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  const _Chip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
    );
  }
}
