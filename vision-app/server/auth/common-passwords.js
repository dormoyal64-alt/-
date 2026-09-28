// @ts-check
/**
 * A small deny-list of the most common passwords (>= 8 chars, since shorter ones fail the length
 * rule anyway). Compared case-insensitively. Includes common Israeli choices.
 */
export const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '12341234', '12344321', '11223344', '87654321', '98765432',
  '0123456789', '09876543', '147258369', '123123123', '12121212', '11112222', '1q2w3e4r', '1q2w3e4r5t',
  'q1w2e3r4', 'q1w2e3r4t5', '1qaz2wsx', 'zaq12wsx', 'qazwsxedc', 'qwertyui', 'qwertyuiop', 'qwerty123',
  'qwerty12', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'password', 'password1', 'password12', 'password123',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'iloveyou', 'iloveyou1', 'sunshine', 'princess', 'football',
  'baseball', 'welcome1', 'welcome123', 'abc12345', 'abcd1234', 'abcdefgh', 'aa123456', 'a1234567',
  'a12345678', 'admin123', 'administrator', 'letmein1', 'trustno1', 'superman', 'batman123', 'starwars',
  'whatever', 'computer', 'internet', 'michael1', 'jennifer', 'charlie1', 'football1', 'monkey123',
  'dragon123', 'master123', 'shadow123', 'changeme', 'default1', 'secret123', 'mypassword', 'test1234',
  'testtest', 'qwer1234', 'asdf1234', 'zxcv1234', '1234qwer', '1234abcd', '123qweasd', '123abc123',
  'shalom123', 'shalom12', 'israel123', 'israel12', 'yisrael1', 'jerusalem', 'telaviv1', 'maccabi1',
  'hapoel123', 'beitar123', 'ahava123', 'sisma123', 'password!', 'qwerty!@', '!qaz2wsx', 'visionapp',
  'vision123', 'eyesight', 'eyetest1',
]);
