class UserProfileInput {
  final String relationshipType;
  final String displayName;
  final int birthYear;
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
      'gender': gender,
      'nationality': nationality,
      'residingCountry': residingCountry,
      'nativeLanguage': nativeLanguage,
      'learningLanguage': learningLanguage,
      'bio': bio,
      'occupation': occupation,
      'keywords': keywords,
      'qaItems': qaItems,
      'photoUrls': photoUrls,
      'preferredGender': preferredGender,
      'preferredNationality': preferredNationality,
      'preferredAgeMin': preferredAgeMin,
      'preferredAgeMax': preferredAgeMax,
    };
  }
}

abstract class OnboardingRepository {
  Future<void> completeOnboarding(UserProfileInput input);
}
