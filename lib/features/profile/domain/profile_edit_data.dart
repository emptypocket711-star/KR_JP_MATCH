class ProfileEditData {
  const ProfileEditData({
    required this.photoUrls,
    required this.displayName,
    required this.bio,
    required this.relationshipType,
    required this.birthYear,
    required this.birthMonth,
    required this.birthDay,
    required this.keywords,
    required this.preferredAgeMin,
    required this.preferredAgeMax,
    this.gender,
    this.nationality,
    this.residingCountry,
    this.nativeLanguage,
    this.learningLanguage,
    this.preferredGender,
    this.preferredNationality,
  });

  final List<String> photoUrls;
  final String displayName;
  final String bio;
  final String relationshipType;
  final int? birthYear;
  final int? birthMonth;
  final int? birthDay;
  final String? gender;
  final String? nationality;
  final String? residingCountry;
  final String? nativeLanguage;
  final String? learningLanguage;
  final List<String> keywords;
  final String? preferredGender;
  final String? preferredNationality;
  final int preferredAgeMin;
  final int preferredAgeMax;

  factory ProfileEditData.fromMap(Map<String, dynamic> data) {
    return ProfileEditData(
      photoUrls: List<String>.from(data['photoUrls'] as List? ?? const []),
      displayName: data['displayName'] as String? ?? '',
      bio: data['bio'] as String? ?? '',
      relationshipType: data['relationshipType'] as String? ?? '',
      birthYear: (data['birthYear'] as num?)?.toInt(),
      birthMonth: (data['birthMonth'] as num?)?.toInt(),
      birthDay: (data['birthDay'] as num?)?.toInt(),
      gender: data['gender'] as String?,
      nationality: data['nationality'] as String?,
      residingCountry: data['residingCountry'] as String?,
      nativeLanguage: data['nativeLanguage'] as String?,
      learningLanguage: data['learningLanguage'] as String?,
      keywords: List<String>.from(data['keywords'] as List? ?? const []),
      preferredGender: _normalizeAny(data['preferredGender'] as String?),
      preferredNationality:
          _normalizeAny(data['preferredNationality'] as String?),
      preferredAgeMin: (data['preferredAgeMin'] as num?)?.toInt() ?? 18,
      preferredAgeMax: (data['preferredAgeMax'] as num?)?.toInt() ?? 50,
    );
  }

  DateTime? get dateOfBirth {
    final year = birthYear;
    final month = birthMonth;
    final day = birthDay;
    if (year == null || month == null || day == null) return null;
    final date = DateTime(year, month, day);
    if (date.year != year || date.month != month || date.day != day) {
      return null;
    }
    return date;
  }

  Map<String, dynamic> toUpdateMap() {
    final birthDate = dateOfBirth;
    if (birthDate == null) {
      throw StateError('A complete, valid date of birth is required');
    }
    return {
      'displayName': displayName.trim(),
      'bio': bio.trim(),
      'relationshipType': relationshipType,
      'birthYear': birthDate.year,
      'birthMonth': birthDate.month,
      'birthDay': birthDate.day,
      'gender': gender,
      'nationality': nationality,
      'residingCountry': residingCountry,
      'nativeLanguage': nativeLanguage,
      'learningLanguage': learningLanguage,
      'keywords': keywords,
      'photoUrls': photoUrls,
      'preferredGender': _normalizeAny(preferredGender),
      'preferredNationality': _normalizeAny(preferredNationality),
      'preferredAgeMin': preferredAgeMin,
      'preferredAgeMax': preferredAgeMax,
    };
  }

  static String? _normalizeAny(String? value) => value == 'all' ? 'any' : value;
}
