/// Models for the quiz feature. Questions are authored in Google Sheets and
/// imported by a script — this app never creates or edits them, so these are
/// parse-only (no toJson beyond what the lesson save needs).

/// The quiz summary embedded in a lesson response (`lesson.quiz`).
/// Null on every non-quiz lesson, and on quiz lessons with nothing linked yet.
class LessonQuiz {
  final int id;
  final String title;
  final int subjectId;
  final int topicId;
  final String? examTag;
  final int? questionCount;
  final String status; // active | inactive

  /// How many questions the quiz's filter matches right now. Present on
  /// GET /api/lessons/:id; absent (0) elsewhere.
  final int availableQuestions;
  final int servedQuestions;

  /// True when the quiz asks for more questions than the bank can supply.
  final bool isUnderfilled;

  const LessonQuiz({
    required this.id,
    required this.title,
    required this.subjectId,
    required this.topicId,
    required this.status,
    this.examTag,
    this.questionCount,
    this.availableQuestions = 0,
    this.servedQuestions = 0,
    this.isUnderfilled = false,
  });

  bool get isActive => status == 'active';

  /// The quiz cannot serve anything — surface this before the lesson ships.
  bool get isEmpty => availableQuestions == 0;

  factory LessonQuiz.fromJson(Map<String, dynamic> json) => LessonQuiz(
        id: json['id'] as int,
        title: (json['title'] ?? '') as String,
        subjectId: json['subjectId'] as int,
        topicId: json['topicId'] as int,
        examTag: json['examTag'] as String?,
        questionCount: json['questionCount'] as int?,
        status: (json['status'] ?? 'active') as String,
        availableQuestions: (json['availableQuestions'] ?? 0) as int,
        servedQuestions: (json['servedQuestions'] ?? 0) as int,
        isUnderfilled: (json['isUnderfilled'] ?? false) as bool,
      );
}

/// A row in the quiz picker. `linkedLessonTitle` is non-null when this quiz is
/// already serving another lesson — a quiz can only be linked once.
class QuizSummary {
  final int id;
  final String title;
  final int subjectId;
  final int topicId;
  final String? examTag;
  final int? questionCount;
  final String status;
  final String? subjectName;
  final String? topicName;
  final int? linkedLessonId;
  final String? linkedLessonTitle;

  const QuizSummary({
    required this.id,
    required this.title,
    required this.subjectId,
    required this.topicId,
    required this.status,
    this.examTag,
    this.questionCount,
    this.subjectName,
    this.topicName,
    this.linkedLessonId,
    this.linkedLessonTitle,
  });

  /// Disable the row in the picker when this is true.
  bool get isTaken => linkedLessonId != null;
  bool get isActive => status == 'active';

  factory QuizSummary.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>?;
    final topic = json['topic'] as Map<String, dynamic>?;
    final lesson = json['lesson'] as Map<String, dynamic>?;
    return QuizSummary(
      id: json['id'] as int,
      title: (json['title'] ?? '') as String,
      subjectId: json['subjectId'] as int,
      topicId: json['topicId'] as int,
      examTag: json['examTag'] as String?,
      questionCount: json['questionCount'] as int?,
      status: (json['status'] ?? 'active') as String,
      subjectName: subject?['name'] as String?,
      topicName: topic?['name'] as String?,
      linkedLessonId: lesson?['id'] as int?,
      linkedLessonTitle: lesson?['title'] as String?,
    );
  }
}

class QuizOption {
  final int id;
  final String optionText;
  final String? optionImageUrl;
  final int displayOrder;

  /// Only populated by the admin preview endpoint. The student-facing serve
  /// strips it, so treat null as "unknown", never as "wrong".
  final bool? isCorrect;

  const QuizOption({
    required this.id,
    required this.optionText,
    required this.displayOrder,
    this.optionImageUrl,
    this.isCorrect,
  });

  factory QuizOption.fromJson(Map<String, dynamic> json) => QuizOption(
        id: json['id'] as int,
        optionText: (json['optionText'] ?? '') as String,
        optionImageUrl: json['optionImageUrl'] as String?,
        displayOrder: (json['displayOrder'] ?? 0) as int,
        isCorrect: json['isCorrect'] as bool?,
      );
}

class QuizQuestion {
  final int id;
  final String questionText;
  final String? questionImageUrl;
  final String difficulty; // easy | medium | hard
  final double marksCorrect;
  final double marksIncorrect;
  final String? explanation;
  final int? correctOptionId;
  final List<String> tagNames;
  final List<QuizOption> options;

  const QuizQuestion({
    required this.id,
    required this.questionText,
    required this.difficulty,
    required this.marksCorrect,
    required this.marksIncorrect,
    required this.options,
    this.questionImageUrl,
    this.explanation,
    this.correctOptionId,
    this.tagNames = const [],
  });

  /// "+2 / -0.5", or just "+2" when there is no negative marking.
  String get marksLabel {
    final correct = '+${_trim(marksCorrect)}';
    if (marksIncorrect == 0) return correct;
    return '$correct / ${_trim(marksIncorrect)}';
  }

  static String _trim(double value) =>
      value == value.roundToDouble() ? value.toInt().toString() : value.toString();

  factory QuizQuestion.fromJson(Map<String, dynamic> json) => QuizQuestion(
        id: json['id'] as int,
        questionText: (json['questionText'] ?? '') as String,
        questionImageUrl: json['questionImageUrl'] as String?,
        difficulty: (json['difficulty'] ?? 'easy') as String,
        marksCorrect: (json['marksCorrect'] as num?)?.toDouble() ?? 0,
        marksIncorrect: (json['marksIncorrect'] as num?)?.toDouble() ?? 0,
        explanation: json['explanation'] as String?,
        correctOptionId: json['correctOptionId'] as int?,
        tagNames: ((json['tagNames'] ?? []) as List).map((t) => t.toString()).toList(),
        options: ((json['options'] ?? []) as List)
            .map((o) => QuizOption.fromJson(o as Map<String, dynamic>))
            .toList(),
      );
}

/// Response of GET /api/quizzes/:id/preview.
class QuizPreview {
  final QuizSummary quiz;
  final int availableQuestions;
  final bool isUnderfilled;
  final int totalQuestions;
  final double totalMarks;
  final List<QuizQuestion> questions;

  const QuizPreview({
    required this.quiz,
    required this.availableQuestions,
    required this.isUnderfilled,
    required this.totalQuestions,
    required this.totalMarks,
    required this.questions,
  });

  factory QuizPreview.fromJson(Map<String, dynamic> json) => QuizPreview(
        quiz: QuizSummary.fromJson(json['quiz'] as Map<String, dynamic>),
        availableQuestions: (json['availableQuestions'] ?? 0) as int,
        isUnderfilled: (json['isUnderfilled'] ?? false) as bool,
        totalQuestions: (json['totalQuestions'] ?? 0) as int,
        totalMarks: (json['totalMarks'] as num?)?.toDouble() ?? 0,
        questions: ((json['questions'] ?? []) as List)
            .map((q) => QuizQuestion.fromJson(q as Map<String, dynamic>))
            .toList(),
      );
}
