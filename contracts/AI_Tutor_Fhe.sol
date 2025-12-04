pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AITutorFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        uint256 id;
        bool active;
        uint256 startTime;
        uint256 endTime;
    }
    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => uint256) public batchSubmissionCount;

    struct EncryptedStudentData {
        euint32 learningMaterialEngagement; // Encrypted: e.g., 0-100 scale
        euint32 notesQuality;              // Encrypted: e.g., 0-100 scale
        euint32 testResultScore;           // Encrypted: e.g., 0-100 scale
        euint32 weakAreaWeight;            // Encrypted: e.g., 0-100 scale for a specific topic
    }
    mapping(uint256 => mapping(uint256 => EncryptedStudentData)) public studentData; // batchId => studentId => data

    struct EncryptedLearningPlan {
        euint32 topicFocusScore;     // Encrypted: Score for a specific topic to focus on
        euint32 practiceIntensity;   // Encrypted: Intensity of practice for the topic
    }
    mapping(uint256 => mapping(uint256 => EncryptedLearningPlan)) public learningPlans; // batchId => studentId => plan

    struct DecryptionContext {
        uint256 batchId;
        uint256 studentId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event CooldownSecondsUpdated(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId, uint256 startTime);
    event BatchClosed(uint256 indexed batchId, uint256 endTime, uint256 submissionCount);
    event StudentDataSubmitted(address indexed provider, uint256 indexed batchId, uint256 indexed studentId);
    event LearningPlanRequested(uint256 indexed requestId, uint256 indexed batchId, uint256 indexed studentId);
    event LearningPlanDecrypted(uint256 indexed requestId, uint256 indexed batchId, uint256 indexed studentId, uint32 topicFocusScore, uint32 practiceIntensity);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotActive();
    error InvalidBatch();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown(address _address) {
        if (block.timestamp < lastSubmissionTime[_address] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown(address _address) {
        if (block.timestamp < lastDecryptionRequestTime[_address] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[msg.sender] = true;
        cooldownSeconds = 10; // Default cooldown
        currentBatchId = 1; // Start with batch 1
        _openBatch(currentBatchId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        delete isProvider[provider];
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused) {
            paused = true;
            emit ContractPaused(msg.sender);
        } else {
            paused = false;
            emit ContractUnpaused(msg.sender);
        }
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSecondsUpdated(oldCooldown, _cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        _openBatch(currentBatchId);
    }

    function _openBatch(uint256 batchId) internal {
        if (batches[batchId].active) revert BatchNotActive(); // Or a more specific error
        batches[batchId] = Batch({ id: batchId, active: true, startTime: block.timestamp, endTime: 0 });
        emit BatchOpened(batchId, block.timestamp);
    }

    function closeBatch(uint256 batchId) external onlyOwner whenNotPaused {
        if (!batches[batchId].active) revert InvalidBatch();
        batches[batchId].active = false;
        batches[batchId].endTime = block.timestamp;
        emit BatchClosed(batchId, block.timestamp, batchSubmissionCount[batchId]);
    }

    function submitStudentData(
        uint256 studentId,
        euint32 learningMaterialEngagement,
        euint32 notesQuality,
        euint32 testResultScore,
        euint32 weakAreaWeight
    ) external onlyProvider whenNotPaused checkSubmissionCooldown(msg.sender) {
        uint256 batchId = currentBatchId;
        if (!batches[batchId].active) revert BatchNotActive();

        _initIfNeeded(learningMaterialEngagement);
        _initIfNeeded(notesQuality);
        _initIfNeeded(testResultScore);
        _initIfNeeded(weakAreaWeight);

        studentData[batchId][studentId] = EncryptedStudentData({
            learningMaterialEngagement: learningMaterialEngagement,
            notesQuality: notesQuality,
            testResultScore: testResultScore,
            weakAreaWeight: weakAreaWeight
        });

        batchSubmissionCount[batchId]++;
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit StudentDataSubmitted(msg.sender, batchId, studentId);
    }

    function requestLearningPlan(uint256 studentId) external onlyProvider whenNotPaused checkDecryptionCooldown(msg.sender) {
        uint256 batchId = currentBatchId;
        if (!batches[batchId].active) revert BatchNotActive();
        if (!FHE.isInitialized(studentData[batchId][studentId].learningMaterialEngagement)) revert("Student data not initialized");

        // 1. Prepare Ciphertexts for the learning plan components
        euint32 topicFocusScore = _calculateTopicFocusScore(batchId, studentId);
        euint32 practiceIntensity = _calculatePracticeIntensity(batchId, studentId);

        // Store the plan components for state hash verification later
        learningPlans[batchId][studentId] = EncryptedLearningPlan({
            topicFocusScore: topicFocusScore,
            practiceIntensity: practiceIntensity
        });

        // 2. Collect final encrypted results for decryption
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = topicFocusScore.toBytes32();
        cts[1] = practiceIntensity.toBytes32();

        // 3. Compute State Hash
        bytes32 stateHash = _hashCiphertexts(cts);

        // 4. Request Decryption
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        // 5. Store Context
        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            studentId: studentId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit LearningPlanRequested(requestId, batchId, studentId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) external {
        DecryptionContext memory context = decryptionContexts[requestId];

        // a. Replay Guard
        if (context.processed) revert ReplayDetected();

        // b. State Verification
        // Rebuild cts array in the exact same order as in requestLearningPlan
        EncryptedLearningPlan memory plan = learningPlans[context.batchId][context.studentId];
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = plan.topicFocusScore.toBytes32();
        cts[1] = plan.practiceIntensity.toBytes32();

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != context.stateHash) {
            revert StateMismatch();
        }

        // c. Proof Verification
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        // d. Decode & Finalize
        uint32 topicFocusScore = abi.decode(cleartexts[0:32], (uint32));
        uint32 practiceIntensity = abi.decode(cleartexts[32:64], (uint32));

        context.processed = true;
        decryptionContexts[requestId] = context; // Update storage

        emit LearningPlanDecrypted(requestId, context.batchId, context.studentId, topicFocusScore, practiceIntensity);
    }

    function _calculateTopicFocusScore(uint256 batchId, uint256 studentId) internal view returns (euint32) {
        EncryptedStudentData memory data = studentData[batchId][studentId];

        // Example logic: Focus score is higher if test results are low and weak area weight is high
        // (100 - testResultScore) * weakAreaWeight / 100
        euint32 hundred = FHE.asEuint32(100);
        euint32 inverseTestScore = hundred.sub(data.testResultScore);
        euint32 weightedFocus = inverseTestScore.mul(data.weakAreaWeight);
        euint32 focusScore = weightedFocus.mul(FHE.inv(hundred)); // Division by 100
        return focusScore;
    }

    function _calculatePracticeIntensity(uint256 batchId, uint256 studentId) internal view returns (euint32) {
        EncryptedStudentData memory data = studentData[batchId][studentId];

        // Example logic: Intensity is higher if engagement is low but notes quality is good
        // (100 - learningMaterialEngagement) * notesQuality / 100
        euint32 hundred = FHE.asEuint32(100);
        euint32 inverseEngagement = hundred.sub(data.learningMaterialEngagement);
        euint32 weightedIntensity = inverseEngagement.mul(data.notesQuality);
        euint32 intensity = weightedIntensity.mul(FHE.inv(hundred)); // Division by 100
        return intensity;
    }

    function _hashCiphertexts(bytes32[] memory cts) internal view returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 val) internal pure {
        if (!FHE.isInitialized(val)) FHE.init(val);
    }

    function _requireInitialized(euint32 val) internal pure {
        if (!FHE.isInitialized(val)) revert("Ciphertext not initialized");
    }
}