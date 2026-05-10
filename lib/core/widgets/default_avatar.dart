import 'package:flutter/material.dart';

/// nationality: 'KR' | 'JP'
/// gender:      'male' | 'female'
String defaultAvatarAsset({
  required String nationality,
  required String gender,
}) {
  final isKr = nationality == 'KR';
  final isMale = gender == 'male';

  if (isKr && isMale) return 'assets/images/KrM.png';
  if (isKr && !isMale) return 'assets/images/KrFm.png';
  if (!isKr && isMale) return 'assets/images/JPm.png';
  return 'assets/images/JPFm.png';
}

/// 프로필 사진이 없을 때 국적/성별에 맞는 기본 이미지를 보여주는 위젯
class DefaultAvatar extends StatelessWidget {
  final String nationality;
  final String gender;
  final double size;
  final BoxFit fit;

  const DefaultAvatar({
    required this.nationality,
    required this.gender,
    this.size = double.infinity,
    this.fit = BoxFit.cover,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      defaultAvatarAsset(nationality: nationality, gender: gender),
      width: size == double.infinity ? double.infinity : size,
      height: size == double.infinity ? double.infinity : size,
      fit: fit,
    );
  }
}

/// CircleAvatar 형태의 기본 이미지
class DefaultAvatarCircle extends StatelessWidget {
  final String nationality;
  final String gender;
  final double radius;

  const DefaultAvatarCircle({
    required this.nationality,
    required this.gender,
    this.radius = 28,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: radius,
      backgroundImage: AssetImage(
        defaultAvatarAsset(nationality: nationality, gender: gender),
      ),
    );
  }
}
