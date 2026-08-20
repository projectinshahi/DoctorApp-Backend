import 'dart:convert';
import 'package:http/http.dart' as http;

import '../core/const/local_storegae.dart';
import '../core/const/api_constant.dart';
import '../models/quiz_models.dart';

/// Result wrappers, same pattern as ChapterResult / ChapterListResult.
class QuizListResult {
  final bool isSuccess;
  final List<QuizSummary>? quizzes;
  final String? errorMessage;

  QuizListResult._({required this.isSuccess, this.quizzes, this.errorMessage});

  factory QuizListResult.success(List<QuizSummary> quizzes) =>
      QuizListResult._(isSuccess: true, quizzes: quizzes);

  factory QuizListResult.failure(String message) =>
      QuizListResult._(isSuccess: false, errorMessage: message);
}

class QuizPreviewResult {
  final bool isSuccess;
  final QuizPreview? preview;
  final String? errorMessage;

  QuizPreviewResult._({required this.isSuccess, this.preview, this.errorMessage});

  factory QuizPreviewResult.success(QuizPreview preview) =>
      QuizPreviewResult._(isSuccess: true, preview: preview);

  factory QuizPreviewResult.failure(String message) =>
      QuizPreviewResult._(isSuccess: false, errorMessage: message);
}

class QuizResult {
  final bool isSuccess;
  final Map<String, dynamic>? data;
  final String? errorMessage;

  QuizResult._({required this.isSuccess, this.data, this.errorMessage});

  factory QuizResult.success(Map<String, dynamic> data) =>
      QuizResult._(isSuccess: true, data: data);

  factory QuizResult.failure(String message) =>
      QuizResult._(isSuccess: false, errorMessage: message);
}

/// Quizzes are saved *filters* over the question bank (subject + topic +
/// optional exam tag), not copies of questions. Questions themselves are
/// authored in Google Sheets and imported — this service never writes them.
///
///   LIST    -> GET    /api/quizzes
///   PREVIEW -> GET    /api/quizzes/:id/preview     (includes the answer key)
///   CREATE  -> POST   /api/quizzes
///   LINK    -> PUT    /api/lessons/:id  { type: 'quiz', quizId }
///
/// Errors come back as { "error": { "message": "..." } }, same as ChapterService.
class QuizService {
  final String baseUrl;

  QuizService({this.baseUrl = ApiConstant.root});

  Future<String?> _getToken() async {
    final String? adminToken = await AdminLocalStorage.getToken();
    return (adminToken == null || adminToken.isEmpty) ? null : adminToken;
  }

  Map<String, String> _headers(String token) => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      };

  /// Pulls { error: { message } } out of a failed response, falling back to a
  /// generic line when the body isn't the shape we expect (e.g. an HTML 404).
  String _errorMessage(dynamic decoded, int statusCode, String fallbackVerb) {
    if (statusCode == 401) return 'Session expired. Please log in again.';
    if (decoded is Map &&
        decoded['error'] is Map &&
        decoded['error']['message'] != null) {
      return decoded['error']['message'].toString();
    }
    return 'Failed to $fallbackVerb (status $statusCode)';
  }

  dynamic _decode(http.Response response) =>
      response.body.isNotEmpty ? jsonDecode(response.body) : <String, dynamic>{};

  /// Quizzes available to link. Pass [onlyActive] false to include inactive ones.
  ///
  /// Rows whose `isTaken` is true are already serving another lesson and must be
  /// shown disabled — the backend rejects a second link with a 400.
  Future<QuizListResult> getQuizzes({
    int? subjectId,
    int? topicId,
    String? examTag,
    bool onlyActive = true,
  }) async {
    final adminToken = await _getToken();
    if (adminToken == null) {
      return QuizListResult.failure('Session expired. Please log in again.');
    }

    final query = <String, String>{
      if (subjectId != null) 'subjectId': '$subjectId',
      if (topicId != null) 'topicId': '$topicId',
      if (examTag != null && examTag.isNotEmpty) 'examTag': examTag,
      if (onlyActive) 'status': 'active',
    };

    final uri = Uri.parse('$baseUrl/api/quizzes')
        .replace(queryParameters: query.isEmpty ? null : query);

    try {
      final response = await http
          .get(uri, headers: _headers(adminToken))
          .timeout(const Duration(seconds: 15));

      final decoded = _decode(response);

      if (response.statusCode == 200) {
        final list = ((decoded['quizzes'] ?? []) as List)
            .map((q) => QuizSummary.fromJson(q as Map<String, dynamic>))
            .toList();
        return QuizListResult.success(list);
      }
      return QuizListResult.failure(
          _errorMessage(decoded, response.statusCode, 'load quizzes'));
    } on http.ClientException {
      return QuizListResult.failure('Network error. Please check your connection.');
    } on FormatException {
      return QuizListResult.failure('Unexpected response from server.');
    } catch (e) {
      return QuizListResult.failure('Something went wrong: $e');
    }
  }

  /// The admin preview — the same questions a student would be served, but WITH
  /// `isCorrect` and `explanation`. Admin-only; never call this from a student
  /// context.
  Future<QuizPreviewResult> previewQuiz({required int quizId}) async {
    final adminToken = await _getToken();
    if (adminToken == null) {
      return QuizPreviewResult.failure('Session expired. Please log in again.');
    }

    final uri = Uri.parse('$baseUrl/api/quizzes/$quizId/preview');

    try {
      final response = await http
          .get(uri, headers: _headers(adminToken))
          .timeout(const Duration(seconds: 20));

      final decoded = _decode(response);

      if (response.statusCode == 200) {
        return QuizPreviewResult.success(
            QuizPreview.fromJson(decoded as Map<String, dynamic>));
      }
      return QuizPreviewResult.failure(
          _errorMessage(decoded, response.statusCode, 'load the quiz preview'));
    } on http.ClientException {
      return QuizPreviewResult.failure('Network error. Please check your connection.');
    } on FormatException {
      return QuizPreviewResult.failure('Unexpected response from server.');
    } catch (e) {
      return QuizPreviewResult.failure('Something went wrong: $e');
    }
  }

  /// Creates a quiz. [examTag] null means "all exam boards";
  /// [questionCount] null means "serve every matching question".
  Future<QuizResult> createQuiz({
    required String title,
    required int subjectId,
    required int topicId,
    String? examTag,
    int? questionCount,
  }) async {
    final adminToken = await _getToken();
    if (adminToken == null) {
      return QuizResult.failure('Session expired. Please log in again.');
    }

    final uri = Uri.parse('$baseUrl/api/quizzes');
    final body = <String, dynamic>{
      'title': title,
      'subjectId': subjectId,
      'topicId': topicId,
      'examTag': (examTag != null && examTag.isNotEmpty) ? examTag : null,
      'questionCount': questionCount,
    };

    try {
      final response = await http
          .post(uri, headers: _headers(adminToken), body: jsonEncode(body))
          .timeout(const Duration(seconds: 15));

      final decoded = _decode(response);

      if (response.statusCode == 201) {
        return QuizResult.success(decoded as Map<String, dynamic>);
      }
      return QuizResult.failure(
          _errorMessage(decoded, response.statusCode, 'create the quiz'));
    } on http.ClientException {
      return QuizResult.failure('Network error. Please check your connection.');
    } on FormatException {
      return QuizResult.failure('Unexpected response from server.');
    } catch (e) {
      return QuizResult.failure('Something went wrong: $e');
    }
  }

  /// Links [quizId] to a lesson, or unlinks it when [quizId] is null.
  ///
  /// The backend only accepts quizId on a quiz-type lesson, so `type` is sent
  /// alongside it. A quiz already linked elsewhere is rejected with a 400 whose
  /// message names the other lesson — surface it as-is.
  Future<QuizResult> linkQuizToLesson({
    required int lessonId,
    required int? quizId,
  }) async {
    final adminToken = await _getToken();
    if (adminToken == null) {
      return QuizResult.failure('Session expired. Please log in again.');
    }

    final uri = Uri.parse('$baseUrl/api/lessons/$lessonId');
    final body = <String, dynamic>{'type': 'quiz', 'quizId': quizId};

    try {
      final response = await http
          .put(uri, headers: _headers(adminToken), body: jsonEncode(body))
          .timeout(const Duration(seconds: 15));

      final decoded = _decode(response);

      if (response.statusCode == 200) {
        return QuizResult.success(decoded as Map<String, dynamic>);
      }
      return QuizResult.failure(
          _errorMessage(decoded, response.statusCode, 'link the quiz'));
    } on http.ClientException {
      return QuizResult.failure('Network error. Please check your connection.');
    } on FormatException {
      return QuizResult.failure('Unexpected response from server.');
    } catch (e) {
      return QuizResult.failure('Something went wrong: $e');
    }
  }
}
