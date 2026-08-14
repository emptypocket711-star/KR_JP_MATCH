class UserProfileInput {
  final String relationshipType;
  final String displayName;
  final int birthYear;
  final int birthMonth;
  final int birthDay;
  final String gender;
  final String nationality;
  final String residingCountry;
  final String nativeLanguage;
  final String learningLanguage;
  final String bio;
  final String occupation;
  final List<String> keywords;
  final List<Map<String, String>> qaItems;
  final List<String> photoUrls;
  final String? preferredGender;
  final String? preferredNationality;
  final int? preferredAgeMin;
  final int? preferredAgeMax;

  UserProfileInput({
    required this.relationshipType,
    required this.displayName,
    required this.birthYear,
    required this.birthMonth,
    required this.birthDay,
    required this.gender,
    required this.nationality,
    required this.residingCountry,
    required this.nativeLanguage,
    required this.learningLanguage,
    required this.bio,
    this.occupation = '',
    required this.keywords,
    required this.qaItems,
    required this.photoUrls,
    this.preferredGender,
    this.preferredNationality,
    this.preferredAgeMin,
    this.preferredAgeMax,
  });

  Map<String, dynamic> toMap() {
    return {
      'relationshipType': relationshipType,
      'displayName': displayName,
      'birthYear': birthYear,
      'birthMonth': birthMonth,
      'birthDay': birthDay,
      'gender': gender,
      'nationality': nationality,
      'residingCountry': residingCountry,
      'nativeLanguage': nativeLanguage,
      'learningLanguage': learningLanguage,
      'bio': bio,
      'occupation': occupation,
      'keywords': keywords,
      'qaItems': completedQaItems(qaItems),
      'photoUrls': photoUrls,
      'preferredGender': preferredGender,
      'preferredNationality': preferredNationality,
      'preferredAgeMin': preferredAgeMin,
      'preferredAgeMax': preferredAgeMax,
    };
  }
}

List<Map<String, String>> completedQaItems(
  Iterable<Map<String, String>> items,
) {
  return [
    for (final item in items)
      if ((item['question'] ?? '').trim().isNotEmpty &&
          (item['answer'] ?? '').trim().isNotEmpty)
        {
          'question': item['question']!.trim(),
          'answer': item['answer']!.trim(),
        },
  ];
}

abstract class OnboardingRepository {
  Future<void> completeOnboarding(UserProfileInput input);

  Future<List<String>> uploadProfilePhotos(List<String> localPaths);

  Future<void> deleteProfilePhoto(String reference);
}
